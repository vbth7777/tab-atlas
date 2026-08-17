
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
} from '@/src/domain/workspace-service';
import type { TabSnapshot } from '@/src/domain/workspace';
import type { ExtensionMessage, ExtensionResponse, WindowContext } from '@/src/shared/messages';

const repository = new ChromeLocalWorkspaceRepository();
const activating = new Map<string, Promise<unknown>>();
const pendingSyncs = new Map<number, ReturnType<typeof setTimeout>>();
const SYNC_DEBOUNCE_MS = 250;
const openingWindows = new Set<number>();

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

/** Collapses bursts of tab events (page loads, drag reordering) into one write. */
function scheduleSync(windowId: number | undefined): void {
  if (windowId === undefined || windowId === browser.windows.WINDOW_ID_NONE || openingWindows.has(windowId)) return;

  clearTimeout(pendingSyncs.get(windowId));
  pendingSyncs.set(
    windowId,
    setTimeout(() => {
      pendingSyncs.delete(windowId);
      void syncWindow(windowId);
    }, SYNC_DEBOUNCE_MS),
  );
}

async function resolveWindowId(sender: Browser.runtime.MessageSender): Promise<number | null> {
  if (sender.tab?.windowId !== undefined) return sender.tab.windowId;

  const focused = await browser.windows.getLastFocused();
  return focused.id ?? null;
}

async function getWindowContext(windowId: number | null): Promise<WindowContext> {
  if (windowId === null) return { windowId: null, webTabCount: 0, workspace: null };

  const [store, tabs] = await Promise.all([repository.read(), windowTabs(windowId)]);
  return {
    windowId,
    webTabCount: tabs.filter(isWebTab).length,
    workspace: findWorkspaceByWindow(store, windowId),
  };
}

/** Focuses the workspace window, or reopens the workspace in a window of its own. */
async function activateWorkspace(workspaceId: string, incognito?: boolean) {
  const key = `${workspaceId}_${incognito ? 'incognito' : 'normal'}`;
  const inFlight = activating.get(key);
  if (inFlight) return inFlight as Promise<ReturnType<typeof openWorkspaceWindow>>;

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

async function openWorkspaceWindow(workspaceId: string, incognito?: boolean) {
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
      if (incognito === undefined || existing.incognito === incognito) {
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

    // Release sync lock after 3 seconds
    setTimeout(() => {
      openingWindows.delete(createdId);
    }, 3000);

    const synced = await repository.get(workspaceId);
    return synced ?? workspace;
  } catch (err: any) {
    if (incognito && (err?.message?.toLowerCase().includes('incognito') || err?.message?.toLowerCase().includes('permission'))) {
      throw new Error('Chưa cấp quyền Ẩn danh. Vui lòng vào chrome://extensions -> Tìm "Tab Atlas" -> Bật "Cho phép ở chế độ ẩn danh" (Allow in Incognito).');
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

      const target = await browser.windows.get(windowId);
      const synced = await syncWorkspaceFromWindow(repository, {
        windowId,
        tabs: await windowTabs(windowId),
        isIncognito: Boolean(target.incognito),
      });
      if (!synced) throw new Error('This workspace is not linked to an open window.');
      return { ok: true, workspace: synced };
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

    case 'update-workspace':
      return {
        ok: true,
        workspace: await updateWorkspaceMetadata(repository, { id: message.workspaceId, name: message.name, color: message.color }),
      };

    case 'delete-workspace':
      await repository.remove(message.workspaceId);
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
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender) =>
    handleMessage(message, sender).catch((error: unknown): ExtensionResponse => ({
      ok: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred.',
    })),
  );

  browser.tabs.onCreated.addListener((tab) => scheduleSync(tab.windowId));
  browser.tabs.onMoved.addListener((_tabId, info) => scheduleSync(info.windowId));
  browser.tabs.onAttached.addListener((_tabId, info) => scheduleSync(info.newWindowId));
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
  browser.tabs.onRemoved.addListener((_tabId, info) => {
    if (!info.isWindowClosing) scheduleSync(info.windowId);
  });

  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.title || changeInfo.favIconUrl) scheduleSync(tab.windowId);
  });

  browser.tabs.onReplaced.addListener(async (addedTabId) => {
    try {
      scheduleSync((await browser.tabs.get(addedTabId)).windowId);
    } catch {
      // The replacement tab is already gone; the next event will reconcile.
    }
  });

  browser.windows.onRemoved.addListener(async (windowId) => {
    clearTimeout(pendingSyncs.get(windowId));
    pendingSyncs.delete(windowId);
    await disconnectWindow(repository, windowId);
  });

  // Chrome window ids do not survive a restart, so drop links to windows that are gone.
  const reconcile = async () => {
    const windows = await browser.windows.getAll();
    await reconcileOpenWindows(repository, windows.map((item) => item.id).filter((id): id is number => id !== undefined));
  };

  browser.runtime.onStartup.addListener(() => void reconcile());
  browser.runtime.onInstalled.addListener(() => void reconcile());
  void reconcile();
});


