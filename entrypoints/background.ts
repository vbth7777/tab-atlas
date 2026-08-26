import { ChromeLocalWorkspaceRepository, migrateWorkspaceStore } from '@/src/data/chrome-local-workspace-repository';
import type { WorkspaceRepository } from '@/src/data/workspace-repository';
import {
  bindWindowToWorkspace,
  clearWorkspaceHistory,
  createLiveWorkspace,
  disconnectWindow,
  extractWebUrl,
  findWorkspaceByWindow,
  mergeWorkspaceStores,
  reconcileOpenWindows,
  recordWorkspaceHistoryBatch,
  syncWorkspaceFromWindow,
  updateWorkspaceMetadata,
  deleteWorkspace,
  deduplicateWorkspace,
  addTabsToWorkspace,
  splitWorkspace,
  mergeChildrenToParent,
  createChildWorkspace,
  moveTabsBetweenWorkspaces,
  deduplicateWorkspaceTree,
} from '@/src/domain/workspace-service';
import type { Workspace, WorkspaceHistoryEntry } from '@/src/domain/workspace';
import type { ExtensionMessage, ExtensionResponse, WindowContext } from '@/src/shared/messages';

const SYNC_DEBOUNCE_MS = 250;

const repository: WorkspaceRepository = new ChromeLocalWorkspaceRepository();

const pendingSyncs = new Map<number, ReturnType<typeof setTimeout>>();
const activating = new Map<string, Promise<unknown>>();

interface CachedTabInfo {
  id: number;
  url: string;
  title: string;
  favIconUrl?: string;
  windowId: number;
  isIncognito: boolean;
}

const tabSnapshotCache = new Map<number, CachedTabInfo>();
const globalRecentlyClosed: WorkspaceHistoryEntry[] = [];
const pendingClosureBuffer = new Map<number, Array<Omit<WorkspaceHistoryEntry, 'id'>>>();
const pendingClosureTimers = new Map<number, ReturnType<typeof setTimeout>>();
const lastRecordedVisits = new Map<string, number>();

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function updateTabCache(tab: {
  id?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
  windowId?: number;
  incognito?: boolean;
}) {
  if (tab.id === undefined || tab.windowId === undefined) return;
  const rawUrl = tab.pendingUrl || tab.url;
  const realUrl = extractWebUrl(rawUrl);
  if (!realUrl) return;

  let isIncognito = Boolean(tab.incognito);
  if (!tab.incognito) {
    try {
      const win = await browser.windows.get(tab.windowId);
      isIncognito = Boolean(win.incognito);
    } catch {}
  }

  tabSnapshotCache.set(tab.id, {
    id: tab.id,
    url: realUrl,
    title: tab.title || realUrl,
    favIconUrl: tab.favIconUrl,
    windowId: tab.windowId,
    isIncognito,
  });
}

async function populateAllTabsCache() {
  try {
    const tabs = await browser.tabs.query({});
    for (const t of tabs) {
      await updateTabCache(t as any);
    }
  } catch {}
}

async function trackTabVisit(tabId: number, windowId: number) {
  const cached = tabSnapshotCache.get(tabId);
  if (!cached || !cached.url) return;

  const store = await repository.read();
  const workspace = findWorkspaceByWindow(store, windowId);
  if (!workspace) return;

  const visitKey = `${workspace.id}_${cached.url}`;
  const now = Date.now();
  const lastVisit = lastRecordedVisits.get(visitKey) || 0;
  if (now - lastVisit < 10000) {
    return;
  }
  lastRecordedVisits.set(visitKey, now);

  try {
    await recordWorkspaceHistoryBatch(repository, workspace.id, [
      {
        tabId: cached.id,
        url: cached.url,
        title: cached.title,
        faviconUrl: cached.favIconUrl,
        hostname: getHostname(cached.url),
        timestamp: new Date().toISOString(),
        eventType: 'visited',
        isIncognito: cached.isIncognito,
      },
    ]);
  } catch (err) {
    console.warn('[Atlas Tab] Failed to track tab visit:', err);
  }
}

function handleTabRemoved(tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) {
  const cached = tabSnapshotCache.get(tabId);
  tabSnapshotCache.delete(tabId);

  if (removeInfo.isWindowClosing) {
    return;
  }

  if (!cached || !cached.url) return;

  const windowId = removeInfo.windowId;
  const entry: Omit<WorkspaceHistoryEntry, 'id'> = {
    tabId: cached.id,
    url: cached.url,
    title: cached.title,
    faviconUrl: cached.favIconUrl,
    hostname: getHostname(cached.url),
    timestamp: new Date().toISOString(),
    eventType: 'closed',
    isIncognito: cached.isIncognito,
  };

  const buffer = pendingClosureBuffer.get(windowId) || [];
  buffer.push(entry);
  pendingClosureBuffer.set(windowId, buffer);

  const existingTimer = pendingClosureTimers.get(windowId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  pendingClosureTimers.set(
    windowId,
    setTimeout(async () => {
      pendingClosureTimers.delete(windowId);
      const itemsToFlush = pendingClosureBuffer.get(windowId) || [];
      pendingClosureBuffer.delete(windowId);
      if (itemsToFlush.length === 0) return;

      const batchId = itemsToFlush.length > 1 ? `batch_${Date.now()}` : undefined;
      const entriesWithBatch = itemsToFlush.map((item) => ({
        ...item,
        batchId: item.batchId || batchId,
      }));

      // Push to global recently closed stack
      for (const item of entriesWithBatch) {
        globalRecentlyClosed.unshift({
          id: `hist_${crypto.randomUUID()}`,
          ...item,
        });
      }
      if (globalRecentlyClosed.length > 100) {
        globalRecentlyClosed.length = 100;
      }

      // Push to Workspace history if window belongs to a workspace
      try {
        const store = await repository.read();
        const workspace = findWorkspaceByWindow(store, windowId);
        if (workspace) {
          await recordWorkspaceHistoryBatch(repository, workspace.id, entriesWithBatch);
        }
      } catch (err) {
        console.warn('[Atlas Tab] Failed to record workspace closure history:', err);
      }
    }, 350)
  );
}

async function restoreTab(url: string, isIncognito?: boolean, preferredWindowId?: number) {
  if (isIncognito) {
    if (preferredWindowId !== undefined) {
      try {
        const targetWin = await browser.windows.get(preferredWindowId);
        if (targetWin.incognito) {
          await browser.tabs.create({ windowId: preferredWindowId, url });
          return;
        }
      } catch {}
    }

    try {
      const windows = await browser.windows.getAll();
      const incognitoWin = windows.find((w) => w.incognito && w.id !== undefined);
      if (incognitoWin && incognitoWin.id !== undefined) {
        await browser.tabs.create({ windowId: incognitoWin.id, url });
        await browser.windows.update(incognitoWin.id, { focused: true });
        return;
      }
    } catch {}

    await browser.windows.create({ url, incognito: true, focused: true });
    return;
  }

  if (preferredWindowId !== undefined) {
    try {
      const targetWin = await browser.windows.get(preferredWindowId);
      if (!targetWin.incognito) {
        await browser.tabs.create({ windowId: preferredWindowId, url });
        return;
      }
    } catch {}
  }

  await browser.tabs.create({ url });
}

async function restoreBatch(urls: string[], isIncognito?: boolean, preferredWindowId?: number): Promise<number> {
  if (urls.length === 0) return 0;
  if (isIncognito) {
    let targetWinId = preferredWindowId;
    if (targetWinId !== undefined) {
      try {
        const targetWin = await browser.windows.get(targetWinId);
        if (!targetWin.incognito) targetWinId = undefined;
      } catch {
        targetWinId = undefined;
      }
    }

    if (targetWinId === undefined) {
      const windows = await browser.windows.getAll();
      const incogWin = windows.find((w) => w.incognito && w.id !== undefined);
      targetWinId = incogWin?.id;
    }

    if (targetWinId !== undefined) {
      for (const url of urls) {
        await browser.tabs.create({ windowId: targetWinId, url, active: false });
      }
      await browser.windows.update(targetWinId, { focused: true });
    } else {
      await browser.windows.create({ url: urls, incognito: true, focused: true });
    }
    return urls.length;
  }

  let targetWinId = preferredWindowId;
  if (targetWinId !== undefined) {
    try {
      const targetWin = await browser.windows.get(targetWinId);
      if (targetWin.incognito) targetWinId = undefined;
    } catch {
      targetWinId = undefined;
    }
  }

  if (targetWinId !== undefined) {
    for (const url of urls) {
      await browser.tabs.create({ windowId: targetWinId, url, active: false });
    }
  } else {
    for (const url of urls) {
      await browser.tabs.create({ url, active: false });
    }
  }
  return urls.length;
}

function isWebTab(tab: { url?: string; pendingUrl?: string }): boolean {
  return extractWebUrl(tab.pendingUrl || tab.url) !== null;
}

async function windowTabs(windowId: number) {
  try {
    const tabs = await browser.tabs.query({ windowId });
    return tabs
      .filter((tab): tab is typeof tab & { id: number } => tab.id !== undefined)
      .map((tab) => ({
        id: tab.id,
        url: tab.url,
        pendingUrl: (tab as any).pendingUrl,
        title: tab.title,
        favIconUrl: tab.favIconUrl,
        status: tab.status,
      }));
  } catch {
    return [];
  }
}

async function syncWindow(windowId: number): Promise<void> {
  try {
    const store = await repository.read();
    const bound = findWorkspaceByWindow(store, windowId);
    if (!bound) return;

    let isIncognito = false;
    try {
      const target = await browser.windows.get(windowId);
      isIncognito = Boolean(target.incognito);
    } catch {
      isIncognito = Boolean(bound.live.isIncognito);
    }

    const tabs = await windowTabs(windowId);
    if (tabs.length === 0) return;

    await syncWorkspaceFromWindow(repository, {
      windowId,
      tabs,
      isIncognito,
    });
  } catch {
    // The window disappeared between the event and this read; windows.onRemoved cleans up.
  }
}

const openingWindows = new Set<number>();

/** Collapses bursts of tab events (page loads, drag reordering) into one write. */
function scheduleSync(windowId: number | undefined): void {
  if (windowId === undefined || windowId === browser.windows.WINDOW_ID_NONE || openingWindows.has(windowId)) return;

  const existing = pendingSyncs.get(windowId);
  if (existing !== undefined) clearTimeout(existing);

  pendingSyncs.set(
    windowId,
    setTimeout(() => {
      pendingSyncs.delete(windowId);
      void syncWindow(windowId);
    }, SYNC_DEBOUNCE_MS),
  );
}

async function resolveWindowId(sender: Browser.runtime.MessageSender): Promise<number | null> {
  if (sender.tab?.windowId !== undefined && sender.tab.windowId !== browser.windows.WINDOW_ID_NONE) {
    return sender.tab.windowId;
  }
  const focused = await browser.windows.getLastFocused({ populate: false });
  return focused.id ?? null;
}

async function getWindowContext(windowId: number | null): Promise<WindowContext> {
  if (windowId === null) return { windowId: null, webTabCount: 0, workspace: null };
  const store = await repository.read();
  const workspace = findWorkspaceByWindow(store, windowId);
  const tabs = await windowTabs(windowId);
  return {
    windowId,
    webTabCount: tabs.filter(isWebTab).length,
    workspace,
  };
}

async function activateWorkspace(workspaceId: string, incognito?: boolean): Promise<Workspace> {
  const inFlight = activating.get(workspaceId);
  if (inFlight) {
    await inFlight;
    const current = await repository.get(workspaceId);
    if (!current) throw new Error('Workspace not found.');
    return current;
  }

  const task = openWorkspaceWindow(workspaceId, incognito);
  activating.set(workspaceId, task);

  try {
    return (await task) as Workspace;
  } finally {
    activating.delete(workspaceId);
  }
}

function toOpenTabUrl(tab: { url?: string; title?: string; faviconUrl?: string }, isActive: boolean, isIncognito: boolean): string {
  const url = tab.url || 'about:blank';
  if (isIncognito || isActive) {
    return url;
  }
  const params = new URLSearchParams({
    url,
    title: tab.title || url,
  });
  if (tab.faviconUrl) {
    params.set('favIconUrl', tab.faviconUrl);
  }
  return browser.runtime.getURL(`/suspended.html?${params.toString()}` as any);
}

async function openWorkspaceWindow(workspaceId: string, incognito?: boolean) {
  const workspace = await repository.get(workspaceId);
  if (!workspace) throw new Error('Workspace not found.');

  if (incognito) {
    const isAllowed = await browser.extension.isAllowedIncognitoAccess();
    if (!isAllowed) {
      throw new Error(
        'Chưa cấp quyền Ẩn danh. Vui lòng vào chrome://extensions -> Tìm "Atlas Tab" -> Bật "Cho phép ở chế độ ẩn danh" (Allow in Incognito).'
      );
    }
  }

  const windowId = workspace.live.windowId;
  if (workspace.live.status === 'connected' && windowId !== undefined) {
    try {
      const existing = await browser.windows.get(windowId);
      if (incognito === undefined || existing.incognito === incognito) {
        await browser.windows.update(windowId, { focused: true });
        return workspace;
      }
      await disconnectWindow(repository, windowId);
    } catch {
      await disconnectWindow(repository, windowId);
    }
  }

  const validTabs = workspace.tabs.filter((tab) => Boolean(tab.url));
  if (!validTabs.length) throw new Error('This workspace has no saved web tabs to open.');

  try {
    const isIncog = Boolean(incognito);
    const urlsToOpen = validTabs.map((tab, idx) => toOpenTabUrl(tab, idx === 0, isIncog));

    const created = await browser.windows.create({
      url: urlsToOpen,
      focused: true,
      incognito: isIncog,
    });
    const createdId = created?.id;
    if (createdId === undefined) throw new Error('Chrome could not open a window for this workspace.');

    openingWindows.add(createdId);

    await bindWindowToWorkspace(repository, { workspaceId, windowId: createdId, isIncognito: isIncog });

    if (isIncog && browser.tabs.discard) {
      const discardedTabIds = new Set<number>();
      const activeTabId = created?.tabs?.[0]?.id;

      const incognitoDiscarder = (tabId: number, _changeInfo: any, tab: any) => {
        if (tab.windowId === createdId && tabId !== activeTabId && !tab.active && !discardedTabIds.has(tabId)) {
          if (tab.url && tab.url !== 'about:blank') {
            discardedTabIds.add(tabId);
            try {
              void browser.tabs.discard(tabId).catch(() => {});
            } catch {}
          }
        }
      };

      browser.tabs.onUpdated.addListener(incognitoDiscarder);

      setTimeout(async () => {
        try {
          const currentTabs = await browser.tabs.query({ windowId: createdId });
          for (const t of currentTabs) {
            if (t.id && t.id !== activeTabId && !t.active && !discardedTabIds.has(t.id) && t.url && t.url !== 'about:blank') {
              discardedTabIds.add(t.id);
              try {
                await browser.tabs.discard(t.id);
              } catch {}
            }
          }
        } catch {}
      }, 350);

      setTimeout(() => {
        browser.tabs.onUpdated.removeListener(incognitoDiscarder);
      }, 5000);
    }

    setTimeout(() => {
      openingWindows.delete(createdId);
    }, 3000);

    const synced = await repository.get(workspaceId);
    return synced ?? workspace;
  } catch (err: any) {
    if (incognito && (err?.message?.toLowerCase().includes('incognito') || err?.message?.toLowerCase().includes('permission'))) {
      throw new Error('Chưa cấp quyền Ẩn danh. Vui lòng vào chrome://extensions -> Tìm "Atlas Tab" -> Bật "Cho phép ở chế độ ẩn danh" (Allow in Incognito).');
    }
    throw err;
  }
}

async function handleMessage(message: ExtensionMessage, sender: Browser.runtime.MessageSender): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'list-workspaces':
      return { ok: true, workspaces: await repository.list() };

    case 'get-window-context':
      return { ok: true, context: await getWindowContext(await resolveWindowId(sender)) };

    case 'create-live-workspace': {
      const windowId = await resolveWindowId(sender);
      if (windowId === null) throw new Error('Could not determine which window to link.');

      const win = await browser.windows.get(windowId);
      const tabs = await windowTabs(windowId);
      if (!tabs.some(isWebTab)) throw new Error('There are no saveable web tabs in this window.');

      const created = await createLiveWorkspace(repository, {
        name: message.name,
        color: message.color,
        windowId,
        tabs,
        isIncognito: Boolean(win.incognito),
      });
      return { ok: true, workspace: created };
    }

    case 'activate-workspace':
      return { ok: true, workspace: await activateWorkspace(message.workspaceId, message.incognito) };

    case 'sync-workspace': {
      const workspace = await repository.get(message.workspaceId);
      const windowId = workspace?.live.windowId;
      if (!workspace || workspace.live.status !== 'connected' || windowId === undefined) {
        throw new Error('This workspace is not linked to an open window.');
      }

      await syncWorkspaceFromWindow(repository, { windowId, tabs: await windowTabs(windowId) });
      const synced = await repository.get(message.workspaceId);
      return { ok: true, workspace: synced ?? workspace };
    }

    case 'detach-workspace': {
      const workspace = await repository.get(message.workspaceId);
      if (!workspace) throw new Error('Workspace not found.');

      if (workspace.live.windowId !== undefined) await disconnectWindow(repository, workspace.live.windowId);
      const detached = await repository.get(message.workspaceId);
      return { ok: true, workspace: detached ?? workspace };
    }

    case 'open-tab':
      await browser.tabs.create({ url: message.url });
      return { ok: true };

    case 'update-workspace': {
      const updated = await updateWorkspaceMetadata(repository, { id: message.workspaceId, name: message.name, color: message.color });
      return { ok: true, workspace: updated };
    }

    case 'delete-workspace':
      await deleteWorkspace(repository, message.workspaceId);
      return { ok: true };

    case 'open-dashboard':
      await browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html' as any) });
      return { ok: true };

    case 'export-workspaces': {
      const store = await repository.read();
      return { ok: true, storeJson: JSON.stringify(store, null, 2) };
    }

    case 'import-workspaces': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.jsonText);
      } catch {
        throw new Error('Invalid JSON format.');
      }

      if (typeof parsed === 'object' && parsed !== null && 'tab-atlas.workspace-store' in parsed) {
        parsed = (parsed as Record<string, unknown>)['tab-atlas.workspace-store'];
      }

      const importedStore = migrateWorkspaceStore(parsed);
      if (!importedStore.workspaces || !importedStore.workspaces.length) {
        throw new Error('No valid workspaces found in the JSON file.');
      }

      const currentStore = await repository.read();
      const mergedStore = mergeWorkspaceStores(currentStore, importedStore);
      await repository.replace(mergedStore);
      return {
        ok: true,
        message: `Successfully imported and merged ${importedStore.workspaces.length} workspace(s). Total: ${mergedStore.workspaces.length}`,
      };
    }

    case 'restore-closed-tab': {
      await restoreTab(message.url, message.isIncognito, message.windowId);
      return { ok: true };
    }

    case 'restore-closed-batch': {
      const count = await restoreBatch(message.urls, message.isIncognito, message.windowId);
      return { ok: true, count };
    }

    case 'clear-workspace-history': {
      const updated = await clearWorkspaceHistory(repository, message.workspaceId);
      return { ok: true, workspace: updated };
    }

    case 'get-recently-closed': {
      if (message.workspaceId) {
        const workspace = await repository.get(message.workspaceId);
        const closed = (workspace?.history || []).filter((h) => h.eventType === 'closed');
        return { ok: true, entries: closed };
      }
      return { ok: true, entries: globalRecentlyClosed };
    }

    case 'deduplicate-workspace': {
      const workspace = await repository.get(message.workspaceId);
      if (!workspace) throw new Error('Workspace not found.');

      const targetSet = message.targetUrls ? new Set(message.targetUrls) : null;
      const windowId = workspace.live.windowId;

      if (workspace.live.status === 'connected' && windowId !== undefined) {
        try {
          const currentTabs = await browser.tabs.query({ windowId });
          const seenUrls = new Set<string>();
          const tabIdsToRemove: number[] = [];

          for (const t of currentTabs) {
            if (t.id === undefined) continue;
            const realUrl = extractWebUrl(t.pendingUrl || t.url);
            if (!realUrl) continue;

            const shouldDeduplicate = !targetSet || targetSet.has(realUrl);
            if (shouldDeduplicate) {
              if (seenUrls.has(realUrl)) {
                tabIdsToRemove.push(t.id);
              } else {
                seenUrls.add(realUrl);
              }
            }
          }

          if (tabIdsToRemove.length > 0) {
            await browser.tabs.remove(tabIdsToRemove);
          }

          const updatedTabs = await windowTabs(windowId);
          await syncWorkspaceFromWindow(repository, { windowId, tabs: updatedTabs });

          const synced = await repository.get(message.workspaceId);
          return {
            ok: true,
            workspace: synced ?? workspace,
            removedCount: tabIdsToRemove.length,
            affectedGroups: message.targetUrls ? message.targetUrls.length : seenUrls.size,
          };
        } catch (err) {
          console.warn('[Atlas Tab] Failed to remove duplicate tabs from live window, falling back to repository update:', err);
        }
      }

      const res = await deduplicateWorkspace(repository, message.workspaceId, message.targetUrls);
      return {
        ok: true,
        workspace: res.workspace,
        removedCount: res.removedCount,
        affectedGroups: res.affectedGroups,
      };
    }

    case 'add-tabs-to-workspace': {
      const targetWorkspace = await repository.get(message.workspaceId);
      if (!targetWorkspace) throw new Error('Target workspace not found.');

      const validTabs: Array<{ url: string; title?: string; faviconUrl?: string }> = [];
      for (const t of message.tabs) {
        const rawUrl = extractWebUrl(t.url);
        if (rawUrl) {
          validTabs.push({
            url: rawUrl,
            title: t.title,
            faviconUrl: t.faviconUrl,
          });
        }
      }

      if (validTabs.length === 0) {
        throw new Error('No valid web tabs to add.');
      }

      const windowId = targetWorkspace.live.windowId;
      let updatedWs: Workspace = targetWorkspace;

      if (targetWorkspace.live.status === 'connected' && windowId !== undefined) {
        try {
          const isIncog = Boolean(targetWorkspace.live.isIncognito);
          for (const tab of validTabs) {
            const openUrl = toOpenTabUrl(tab, false, isIncog);
            await browser.tabs.create({ windowId, url: openUrl, active: false });
          }
          const currentTabs = await windowTabs(windowId);
          await syncWorkspaceFromWindow(repository, { windowId, tabs: currentTabs });
          const synced = await repository.get(message.workspaceId);
          if (synced) updatedWs = synced;
        } catch (err) {
          console.warn('[Atlas Tab] Live window tab creation failed, falling back to repository update:', err);
          const res = await addTabsToWorkspace(repository, message.workspaceId, validTabs);
          updatedWs = res.workspace;
        }
      } else {
        const res = await addTabsToWorkspace(repository, message.workspaceId, validTabs);
        updatedWs = res.workspace;
      }

      if (message.closeSourceTabIds && message.closeSourceTabIds.length > 0) {
        const idsToRemove = message.closeSourceTabIds;
        setTimeout(async () => {
          try {
            await browser.tabs.remove(idsToRemove);
          } catch (err) {
            console.warn('[Atlas Tab] Failed to close source tabs:', err);
          }
        }, 100);
      }

      return {
        ok: true,
        workspace: updatedWs,
        addedCount: validTabs.length,
      };
    }

    case 'split-workspace': {
      const res = await splitWorkspace(repository, {
        parentWorkspaceId: message.parentWorkspaceId,
        splitMode: message.splitMode,
        value: message.value,
        childNamePrefix: message.childNamePrefix,
        colors: message.colors,
        moveTabs: message.moveTabs,
      });
      return {
        ok: true,
        parent: res.parent,
        children: res.children,
      };
    }

    case 'merge-children-to-parent': {
      const res = await mergeChildrenToParent(repository, message.parentWorkspaceId, message.deleteChildren);
      return {
        ok: true,
        parent: res.parent,
        mergedTabsCount: res.mergedTabsCount,
        affectedChildrenCount: res.affectedChildrenCount,
      };
    }

    case 'create-child-workspace': {
      const childWs = await createChildWorkspace(
        repository,
        message.parentId,
        message.name,
        message.color,
        message.initialTabs,
        message.removeTabsFromParent
      );
      return {
        ok: true,
        workspace: childWs,
      };
    }

    case 'move-tabs-between-workspaces': {
      const res = await moveTabsBetweenWorkspaces(
        repository,
        message.sourceWorkspaceId,
        message.targetWorkspaceId,
        message.tabIds
      );
      return {
        ok: true,
        source: res.source,
        target: res.target,
        movedCount: res.movedCount,
      };
    }

    case 'deduplicate-tree': {
      const res = await deduplicateWorkspaceTree(repository, message.rootWorkspaceId, message.targetUrls);
      return {
        ok: true,
        affectedWorkspacesCount: res.affectedWorkspacesCount,
        totalRemovedCount: res.totalRemovedCount,
      };
    }

    case 'activate-tree': {
      const allWorkspaces = await repository.list();
      const parent = allWorkspaces.find((w) => w.id === message.parentWorkspaceId);
      if (!parent) throw new Error('Parent workspace not found.');

      const children = allWorkspaces.filter((w) => w.parentId === message.parentWorkspaceId);
      const workspacesToOpen = [parent, ...children].filter((w) => w.tabs.length > 0);

      let opened = 0;
      for (const ws of workspacesToOpen) {
        const isIncog = message.incognito !== undefined ? message.incognito : Boolean(ws.live.isIncognito);
        const openTabs = ws.tabs.map((t) => toOpenTabUrl(t, false, isIncog));
        if (openTabs.length > 0) {
          const win = await browser.windows.create({
            url: openTabs,
            incognito: isIncog,
            focused: opened === 0,
          });
          if (win && win.id !== undefined) {
            await bindWindowToWorkspace(repository, { workspaceId: ws.id, windowId: win.id, isIncognito: isIncog });
            opened++;
          }
        }
      }

      return {
        ok: true,
        openedCount: opened,
      };
    }

    default:
      throw new Error(`Yêu cầu không được hỗ trợ: ${(message as any)?.type}`);
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender) =>
    handleMessage(message, sender).catch((error: unknown): ExtensionResponse => ({
      ok: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred.',
    })),
  );

  browser.tabs.onCreated.addListener((tab) => {
    void updateTabCache(tab as any);
    scheduleSync(tab.windowId);
  });

  browser.tabs.onMoved.addListener((tabId, info) => {
    const cached = tabSnapshotCache.get(tabId);
    if (cached) cached.windowId = info.windowId;
    scheduleSync(info.windowId);
  });

  browser.tabs.onAttached.addListener((tabId, info) => {
    const cached = tabSnapshotCache.get(tabId);
    if (cached) cached.windowId = info.newWindowId;
    scheduleSync(info.newWindowId);
  });

  browser.tabs.onDetached.addListener((_tabId, info) => scheduleSync(info.oldWindowId));

  // Automatically wake up suspended tab when the user switches to it
  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab.url && tab.url.includes('/suspended.html')) {
        const realUrl = extractWebUrl(tab.url);
        if (realUrl) {
          await browser.tabs.update(tabId, { url: realUrl });
        }
      }
    } catch {
      // Tab may have closed
    }
  });

  // Window teardown emits one removal per tab; windows.onRemoved handles that case.
  browser.tabs.onRemoved.addListener((tabId, info) => {
    handleTabRemoved(tabId, info);
    if (!info.isWindowClosing) scheduleSync(info.windowId);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void updateTabCache(tab as any);
    if (changeInfo.status === 'complete' && tab.windowId !== undefined) {
      void trackTabVisit(tabId, tab.windowId);
    }
    if (changeInfo.url || changeInfo.title || changeInfo.favIconUrl) scheduleSync(tab.windowId);
  });

  browser.tabs.onReplaced.addListener(async (addedTabId) => {
    try {
      const tab = await browser.tabs.get(addedTabId);
      void updateTabCache(tab as any);
      scheduleSync(tab.windowId);
    } catch {
      // The replacement tab is already gone; the next event will reconcile.
    }
  });

  browser.windows.onRemoved.addListener(async (windowId) => {
    clearTimeout(pendingSyncs.get(windowId));
    pendingSyncs.delete(windowId);

    const existingTimer = pendingClosureTimers.get(windowId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      pendingClosureTimers.delete(windowId);
      pendingClosureBuffer.delete(windowId);
    }

    try {
      const store = await repository.read();
      const workspace = findWorkspaceByWindow(store, windowId);
      if (workspace && workspace.tabs.length > 0) {
        const tabCount = workspace.tabs.length;
        const windowClosedEntry: Omit<WorkspaceHistoryEntry, 'id'> = {
          url: workspace.tabs[0]?.url || 'workspace://window',
          title: `Closed window session (${tabCount} tabs)`,
          faviconUrl: workspace.tabs[0]?.faviconUrl,
          hostname: `${tabCount} tabs`,
          timestamp: new Date().toISOString(),
          eventType: 'window_closed',
          tabCount,
          isIncognito: Boolean(workspace.live.isIncognito),
          tabsSnapshot: workspace.tabs.map((t) => ({
            title: t.title,
            url: t.url,
            faviconUrl: t.faviconUrl,
          })),
        };

        await recordWorkspaceHistoryBatch(repository, workspace.id, [windowClosedEntry]);
      }
    } catch (err) {
      console.warn('[Atlas Tab] Failed to record window_closed history:', err);
    }

    await disconnectWindow(repository, windowId);
  });

  // Chrome window ids do not survive a restart, so drop links to windows that are gone.
  const reconcile = async () => {
    await populateAllTabsCache();
    const windows = await browser.windows.getAll();
    await reconcileOpenWindows(repository, windows.map((item) => item.id).filter((id): id is number => id !== undefined));
  };

  browser.runtime.onStartup.addListener(() => void reconcile());
  browser.runtime.onInstalled.addListener(() => void reconcile());
  void reconcile();
});
