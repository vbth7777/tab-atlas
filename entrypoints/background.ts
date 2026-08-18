import { ChromeLocalWorkspaceRepository } from '@/src/data/chrome-local-workspace-repository';
import { migrateWorkspaceStore } from '@/src/data/chrome-local-workspace-repository';
import {
  bindWindowToWorkspace,
  createLiveWorkspace,
  disconnectWindow,
  extractWebUrl,
  findWorkspaceByWindow,
  reconcileOpenWindows,
  syncWorkspaceFromWindow,
  updateWorkspaceMetadata,
  mergeWorkspaceStores,
  recordWorkspaceHistoryBatch,
  clearWorkspaceHistory,
} from '@/src/domain/workspace-service';
import type { SavedTab, TabSnapshot, Workspace, WorkspaceColor, WorkspaceHistoryEntry, WorkspaceStore } from '@/src/domain/workspace';
import type { ExtensionMessage, ExtensionResponse, WindowContext } from '@/src/shared/messages';

const repository = new ChromeLocalWorkspaceRepository();
const activating = new Map<string, Promise<Workspace>>();
const pendingSyncs = new Map<number, ReturnType<typeof setTimeout>>();
const SYNC_DEBOUNCE_MS = 250;
const openingWindows = new Set<number>();

// ---------------------------------------------------------------------------
// Real-time Tab Snapshot Cache & History Recovery Engine
// ---------------------------------------------------------------------------

interface CachedTabInfo {
  id: number;
  url: string;
  title: string;
  favIconUrl?: string;
  windowId: number;
  isIncognito?: boolean;
}

const tabSnapshotCache = new Map<number, CachedTabInfo>();
const pendingClosureBuffer = new Map<number, Omit<WorkspaceHistoryEntry, 'id'>[]>();
const pendingClosureTimers = new Map<number, ReturnType<typeof setTimeout>>();
const globalRecentlyClosed: WorkspaceHistoryEntry[] = [];
const lastVisitedUrls = new Map<number, { url: string; time: number }>();

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function populateAllTabsCache() {
  try {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined && tab.windowId !== undefined) {
        const candidateUrl = (tab as any).pendingUrl || tab.url;
        const realUrl = extractWebUrl(candidateUrl);
        if (realUrl) {
          tabSnapshotCache.set(tab.id, {
            id: tab.id,
            url: realUrl,
            title: tab.title || getHostname(realUrl),
            favIconUrl: tab.favIconUrl,
            windowId: tab.windowId,
            isIncognito: Boolean((tab as any).incognito),
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Tab Atlas] Failed to populate initial tab cache:', err);
  }
}

async function updateTabCache(tab: TabSnapshot & { windowId?: number; incognito?: boolean }) {
  if (tab.id === undefined || tab.windowId === undefined) return;
  const candidateUrl = tab.pendingUrl || tab.url;
  const realUrl = extractWebUrl(candidateUrl);
  if (!realUrl) return;

  tabSnapshotCache.set(tab.id, {
    id: tab.id,
    url: realUrl,
    title: tab.title || getHostname(realUrl),
    favIconUrl: tab.favIconUrl,
    windowId: tab.windowId,
    isIncognito: Boolean(tab.incognito),
  });
}

function handleTabRemoved(tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) {
  const cached = tabSnapshotCache.get(tabId);
  tabSnapshotCache.delete(tabId);

  // If the entire window is closing, windows.onRemoved handles recording a single window_closed session
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
        console.warn('[Tab Atlas] Failed to record workspace closure history:', err);
      }
    }, 350)
  );
}

async function restoreTab(url: string, isIncognito?: boolean, preferredWindowId?: number) {
  if (isIncognito) {
    if (preferredWindowId !== undefined) {
      try {
        const targetWin = await browser.windows.get(preferredWindowId);
        if (targetWin?.incognito) {
          await browser.tabs.create({ windowId: preferredWindowId, url });
          return;
        }
      } catch {
        // Target window no longer available
      }
    }
    const allWindows = await browser.windows.getAll();
    const incognitoWin = allWindows.find((w) => Boolean(w.incognito) && w.id !== undefined);
    if (incognitoWin && incognitoWin.id !== undefined) {
      await browser.tabs.create({ windowId: incognitoWin.id, url });
    } else {
      await browser.windows.create({ url, incognito: true });
    }
  } else {
    if (preferredWindowId !== undefined) {
      try {
        const targetWin = await browser.windows.get(preferredWindowId);
        if (targetWin && !targetWin.incognito) {
          await browser.tabs.create({ windowId: preferredWindowId, url });
          return;
        }
      } catch {
        // Target window no longer available
      }
    }
    await browser.tabs.create({ url });
  }
}

async function restoreBatch(urls: string[], isIncognito?: boolean, preferredWindowId?: number) {
  if (urls.length === 0) return 0;
  if (isIncognito) {
    let targetWindowId: number | undefined = preferredWindowId;
    let validTarget = false;
    if (targetWindowId !== undefined) {
      try {
        const targetWin = await browser.windows.get(targetWindowId);
        if (targetWin?.incognito) validTarget = true;
      } catch {
        validTarget = false;
      }
    }
    if (!validTarget) {
      const allWindows = await browser.windows.getAll();
      const incognitoWin = allWindows.find((w) => Boolean(w.incognito) && w.id !== undefined);
      if (incognitoWin && incognitoWin.id !== undefined) {
        targetWindowId = incognitoWin.id;
      } else {
        const newWin = await browser.windows.create({ url: urls[0], incognito: true });
        if (newWin && newWin.id !== undefined && urls.length > 1) {
          for (let i = 1; i < urls.length; i++) {
            await browser.tabs.create({ windowId: newWin.id, url: urls[i] });
          }
        }
        return urls.length;
      }
    }

    for (const url of urls) {
      await browser.tabs.create({ windowId: targetWindowId, url });
    }
    return urls.length;
  } else {
    let targetWindowId: number | undefined = preferredWindowId;
    let validTarget = false;
    if (targetWindowId !== undefined) {
      try {
        const targetWin = await browser.windows.get(targetWindowId);
        if (targetWin && !targetWin.incognito) validTarget = true;
      } catch {
        validTarget = false;
      }
    }

    if (validTarget && targetWindowId !== undefined) {
      for (const url of urls) {
        await browser.tabs.create({ windowId: targetWindowId, url });
      }
    } else {
      const newWin = await browser.windows.create({ url: urls[0] });
      if (newWin && newWin.id !== undefined && urls.length > 1) {
        for (let i = 1; i < urls.length; i++) {
          await browser.tabs.create({ windowId: newWin.id, url: urls[i] });
        }
      }
    }
    return urls.length;
  }
}

async function trackTabVisit(tabId: number, windowId: number) {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab || !tab.url) return;
    const realUrl = extractWebUrl((tab as any).pendingUrl || tab.url);
    if (!realUrl) return;

    // Throttle duplicate records within 10s for the same tab
    const last = lastVisitedUrls.get(tabId);
    const now = Date.now();
    if (last && last.url === realUrl && now - last.time < 10000) {
      return;
    }
    lastVisitedUrls.set(tabId, { url: realUrl, time: now });

    const store = await repository.read();
    const workspace = findWorkspaceByWindow(store, windowId);
    if (!workspace) return;

    const entry: Omit<WorkspaceHistoryEntry, 'id'> = {
      tabId: tab.id,
      url: realUrl,
      title: tab.title || getHostname(realUrl),
      faviconUrl: tab.favIconUrl,
      hostname: getHostname(realUrl),
      timestamp: new Date().toISOString(),
      eventType: 'visited',
      isIncognito: Boolean((tab as any).incognito),
    };

    await recordWorkspaceHistoryBatch(repository, workspace.id, [entry]);
  } catch {
    // Tab might have been removed or query failed
  }
}

// ---------------------------------------------------------------------------
// Standard Workspace & Tab Lifecycle
// ---------------------------------------------------------------------------

function isWebTab(tab: TabSnapshot): boolean {
  return extractWebUrl(tab.pendingUrl || tab.url) !== null;
}

async function windowTabs(windowId: number): Promise<TabSnapshot[]> {
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
      isIncognito = Boolean(target?.incognito);
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

function scheduleSync(windowId?: number): void {
  if (windowId === undefined) return;
  if (openingWindows.has(windowId)) return;

  const existing = pendingSyncs.get(windowId);
  if (existing) clearTimeout(existing);

  pendingSyncs.set(
    windowId,
    setTimeout(() => {
      pendingSyncs.delete(windowId);
      void syncWindow(windowId);
    }, SYNC_DEBOUNCE_MS),
  );
}

/** Focuses the workspace window, or reopens the workspace in a window of its own. */
async function activateWorkspace(workspaceId: string, incognito?: boolean): Promise<Workspace> {
  const key = `${workspaceId}_${incognito ? 'incognito' : 'normal'}`;
  const inFlight = activating.get(key);
  if (inFlight) return inFlight;

  const run = openWorkspaceWindow(workspaceId, incognito).finally(() => activating.delete(key));
  activating.set(key, run);
  return run;
}

function toOpenTabUrl(tab: { url: string; title?: string; faviconUrl?: string }, isFirstTab: boolean, isIncognito: boolean): string {
  if (isFirstTab || isIncognito) {
    // In Incognito windows, Chrome security blocks top-level chrome-extension:// URLs.
    // So Incognito tabs MUST always open directly with their real web URLs!
    return tab.url;
  }
  const params = new URLSearchParams();
  params.set('url', tab.url);
  if (tab.title) params.set('title', tab.title);
  if (tab.faviconUrl) params.set('favicon', tab.faviconUrl);
  return browser.runtime.getURL(`/suspended.html?${params.toString()}` as any);
}

async function openWorkspaceWindow(workspaceId: string, incognito?: boolean): Promise<Workspace> {
  const workspace = await repository.get(workspaceId);
  if (!workspace) throw new Error('Workspace not found.');

  if (incognito) {
    const isAllowed = await browser.extension.isAllowedIncognitoAccess();
    if (!isAllowed) {
      throw new Error(
        'Chưa cấp quyền Ẩn danh. Vui lòng vào chrome://extensions -> Tìm "Tab Atlas" -> Bật "Cho phép ở chế độ ẩn danh" (Allow in Incognito).'
      );
    }
  }

  const windowId = workspace.live.windowId;
  if (workspace.live.status === 'connected' && windowId !== undefined) {
    try {
      const existing = await browser.windows.get(windowId);
      if (incognito === undefined || existing?.incognito === incognito) {
        await browser.windows.update(windowId, { focused: true });
        return workspace;
      }
      // Mode differs: disconnect existing window before opening new window in requested mode
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

    // Open all tabs in one single native call directly in the target window (Incognito or Normal)
    const created = await browser.windows.create({
      url: urlsToOpen,
      focused: true,
      incognito: isIncog,
    });
    const createdId = created?.id;
    if (createdId === undefined) throw new Error('Chrome could not open a window for this workspace.');

    // Suppress sync storms and re-render loops while window is initializing
    openingWindows.add(createdId);

    // Bind window immediately to ensure live status is registered with all saved tabs intact
    await bindWindowToWorkspace(repository, { workspaceId, windowId: createdId, isIncognito: isIncog });

    // In Incognito mode: Native Tab Discarding for background tabs to prevent CPU/RAM lag
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

      // Perform an initial sweep after 350ms for tabs that already committed their URLs
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

      // Remove listener after initial tab burst settles
      setTimeout(() => {
        browser.tabs.onUpdated.removeListener(incognitoDiscarder);
      }, 5000);
    }

    const updated = await repository.get(workspaceId);
    return updated ?? workspace;
  } finally {
    // Release window lock after 1.5s once tabs have finished initial mounting
    setTimeout(() => {
      if (workspace.live.windowId !== undefined) {
        openingWindows.delete(workspace.live.windowId);
      }
    }, 1500);
  }
}

async function getWindowContext(windowId?: number | null): Promise<WindowContext> {
  if (windowId === undefined || windowId === null) {
    return { windowId: null, webTabCount: 0, workspace: null };
  }

  const tabs = await windowTabs(windowId);
  const webTabs = tabs.filter(isWebTab);
  const store = await repository.read();
  const workspace = findWorkspaceByWindow(store, windowId);

  return {
    windowId,
    webTabCount: webTabs.length,
    workspace,
  };
}

async function handleMessage(
  message: ExtensionMessage,
  sender: { tab?: { windowId?: number } },
): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'list-workspaces': {
      const workspaces = await repository.list();
      return { ok: true, workspaces };
    }

    case 'get-window-context': {
      let windowId = sender.tab?.windowId;
      if (windowId === undefined) {
        const currentWindow = await browser.windows.getCurrent();
        windowId = currentWindow.id;
      }
      const context = await getWindowContext(windowId);
      return { ok: true, context };
    }

    case 'create-live-workspace': {
      const currentWindow = await browser.windows.getCurrent();
      if (currentWindow.id === undefined) {
        throw new Error('Cannot identify the active window.');
      }

      const tabs = await windowTabs(currentWindow.id);
      const isIncognito = Boolean(currentWindow.incognito);

      const workspace = await createLiveWorkspace(repository, {
        name: message.name,
        color: message.color,
        windowId: currentWindow.id,
        tabs,
        isIncognito,
      });

      return { ok: true, workspace };
    }

    case 'activate-workspace': {
      const workspace = await activateWorkspace(message.workspaceId, message.incognito);
      return { ok: true, workspace };
    }

    case 'sync-workspace': {
      const store = await repository.read();
      const workspace = store.workspaces.find((item) => item.id === message.workspaceId);
      if (!workspace) throw new Error(`Workspace “${message.workspaceId}” does not exist.`);

      if (workspace.live.status === 'connected' && workspace.live.windowId !== undefined) {
        await syncWindow(workspace.live.windowId);
      }

      const fresh = await repository.get(message.workspaceId);
      if (!fresh) throw new Error('Failed to reload workspace after sync.');
      return { ok: true, workspace: fresh };
    }

    case 'detach-workspace': {
      const store = await repository.read();
      const workspace = store.workspaces.find((item) => item.id === message.workspaceId);
      if (!workspace) throw new Error(`Workspace “${message.workspaceId}” does not exist.`);

      if (workspace.live.windowId !== undefined) {
        await disconnectWindow(repository, workspace.live.windowId);
      }

      const fresh = await repository.get(message.workspaceId);
      if (!fresh) throw new Error('Failed to reload workspace after detaching.');
      return { ok: true, workspace: fresh };
    }

    case 'open-tab': {
      await browser.tabs.create({ url: message.url });
      return { ok: true };
    }

    case 'update-workspace': {
      const workspace = await updateWorkspaceMetadata(repository, {
        id: message.workspaceId,
        name: message.name,
        color: message.color,
      });
      return { ok: true, workspace };
    }

    case 'delete-workspace': {
      await repository.remove(message.workspaceId);
      return { ok: true };
    }

    case 'open-dashboard': {
      const dashboardUrl = browser.runtime.getURL('/dashboard.html');
      const tabs = await browser.tabs.query({ url: `${dashboardUrl}*` });
      const firstTab = tabs[0];
      if (firstTab && firstTab.id !== undefined) {
        await browser.tabs.update(firstTab.id, { active: true });
        if (firstTab.windowId !== undefined) {
          await browser.windows.update(firstTab.windowId, { focused: true });
        }
      } else {
        await browser.tabs.create({ url: dashboardUrl });
      }
      return { ok: true };
    }

    case 'import-workspaces': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.jsonText);
      } catch {
        throw new Error('Invalid JSON format.');
      }

      const importedStore = migrateWorkspaceStore(parsed);
      if (importedStore.workspaces.length === 0) {
        throw new Error('No valid workspaces found in the provided JSON.');
      }

      await repository.update((currentStore) => {
        const merged = mergeWorkspaceStores(currentStore, importedStore);
        return { store: merged, result: undefined };
      });

      return { ok: true, message: `Successfully imported ${importedStore.workspaces.length} workspace(s).` };
    }

    case 'export-workspaces': {
      const store = await repository.read();
      const exportData = {
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        workspaces: store.workspaces.map((ws) => ({
          id: ws.id,
          name: ws.name,
          color: ws.color,
          tabs: ws.tabs,
          history: ws.history || [],
          createdAt: ws.createdAt,
          updatedAt: ws.updatedAt,
        })),
      };
      return { ok: true, storeJson: JSON.stringify(exportData, null, 2) };
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
      await clearWorkspaceHistory(repository, message.workspaceId);
      return { ok: true };
    }

    case 'get-recently-closed': {
      if (message.workspaceId) {
        const workspace = await repository.get(message.workspaceId);
        const closed = (workspace?.history || []).filter((h) => h.eventType === 'closed');
        return { ok: true, entries: closed };
      }
      return { ok: true, entries: globalRecentlyClosed };
    }
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
      if (tab?.url && tab.url.includes('/suspended.html')) {
        const realUrl = extractWebUrl(tab.url);
        if (realUrl) {
          await browser.tabs.update(tabId, { url: realUrl });
        }
      }
    } catch {
      // Tab may have closed
    }
  });

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
      console.warn('[Tab Atlas] Failed to record window_closed history:', err);
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
