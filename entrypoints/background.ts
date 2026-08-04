import { ChromeLocalWorkspaceRepository } from '@/src/data/chrome-local-workspace-repository';
import type { WorkspaceRepository } from '@/src/data/workspace-repository';
import {
  bindWindowToWorkspace,
  createLiveWorkspace,
  disconnectWindow,
  extractWebUrl,
  findWorkspaceByWindow,
  reconcileOpenWindows,
  syncWorkspaceFromWindow,
  updateWorkspaceMetadata,
} from '@/src/domain/workspace-service';
import type { ExtensionMessage, ExtensionResponse, WindowContext } from '@/src/shared/messages';

const SYNC_DEBOUNCE_MS = 250;
const repository: WorkspaceRepository = new ChromeLocalWorkspaceRepository();

const pendingSyncs = new Map<number, ReturnType<typeof setTimeout>>();
const activating = new Map<string, Promise<unknown>>();

function isWebTab(tab: { url?: string }): boolean {
  return extractWebUrl(tab.url) !== null;
}

async function windowTabs(windowId: number) {
  const tabs = await browser.tabs.query({ windowId });
  return tabs.filter((tab): tab is typeof tab & { id: number } => tab.id !== undefined);
}

async function syncWindow(windowId: number): Promise<void> {
  try {
    const target = await browser.windows.get(windowId);
    if (target.incognito) return;
    await syncWorkspaceFromWindow(repository, { windowId, tabs: await windowTabs(windowId) });
  } catch {
    // The window disappeared between the event and this read; windows.onRemoved cleans up.
  }
}

/** Collapses bursts of tab events (page loads, drag reordering) into one write. */
function scheduleSync(windowId: number | undefined): void {
  if (windowId === undefined || windowId === browser.windows.WINDOW_ID_NONE) return;

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

  const focused = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
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
async function activateWorkspace(workspaceId: string) {
  const inFlight = activating.get(workspaceId);
  if (inFlight) return inFlight as Promise<ReturnType<typeof openWorkspaceWindow>>;

  const run = openWorkspaceWindow(workspaceId).finally(() => activating.delete(workspaceId));
  activating.set(workspaceId, run);
  return run;
}

async function openWorkspaceWindow(workspaceId: string) {
  const workspace = await repository.get(workspaceId);
  if (!workspace) throw new Error('Workspace not found.');

  const windowId = workspace.live.windowId;
  if (workspace.live.status === 'connected' && windowId !== undefined) {
    try {
      await browser.windows.update(windowId, { focused: true });
      return workspace;
    } catch {
      await disconnectWindow(repository, windowId);
    }
  }

  if (!workspace.tabs.length) throw new Error('This workspace has no saved web tabs to open.');

  const created = await browser.windows.create({ url: workspace.tabs.map((tab) => tab.url), focused: true });
  const createdId = created?.id;
  if (createdId === undefined) throw new Error('Chrome could not open a window for this workspace.');

  await bindWindowToWorkspace(repository, { workspaceId, windowId: createdId });
  return (await syncWorkspaceFromWindow(repository, { windowId: createdId, tabs: await windowTabs(createdId) })) ?? workspace;
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

      const tabs = await windowTabs(windowId);
      if (!tabs.some(isWebTab)) throw new Error('There are no saveable web tabs in this window.');

      return { ok: true, workspace: await createLiveWorkspace(repository, { name: message.name, color: message.color, windowId, tabs }) };
    }

    case 'activate-workspace':
      return { ok: true, workspace: await activateWorkspace(message.workspaceId) };

    case 'sync-workspace': {
      const workspace = await repository.get(message.workspaceId);
      const windowId = workspace?.live.windowId;
      if (!workspace || workspace.live.status !== 'connected' || windowId === undefined) {
        throw new Error('This workspace is not linked to an open window.');
      }

      const synced = await syncWorkspaceFromWindow(repository, { windowId, tabs: await windowTabs(windowId) });
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
      return { ok: true, workspace: await updateWorkspaceMetadata(repository, { id: message.workspaceId, name: message.name, color: message.color }) };

    case 'delete-workspace':
      await repository.remove(message.workspaceId);
      return { ok: true };

    case 'open-dashboard':
      await browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html' as any) });
      return { ok: true };
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
    const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
    await reconcileOpenWindows(repository, windows.map((item) => item.id).filter((id): id is number => id !== undefined));
  };

  browser.runtime.onStartup.addListener(() => void reconcile());
  browser.runtime.onInstalled.addListener(() => void reconcile());
  void reconcile();
});
