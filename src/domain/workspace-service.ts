import type { SavedTab, TabSnapshot, Workspace, WorkspaceColor, WorkspaceHistoryEntry, WorkspaceStore } from '@/src/domain/workspace';
import type { WorkspaceRepository } from '@/src/data/workspace-repository';

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function extractWebUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;

  if (url.startsWith('chrome-extension://')) {
    try {
      const urlObj = new URL(url);
      let realUrl = urlObj.searchParams.get('url') || urlObj.searchParams.get('uri');
      if (!realUrl && urlObj.hash) {
        const hashParams = new URLSearchParams(urlObj.hash.substring(1));
        realUrl = hashParams.get('url') || hashParams.get('uri');
      }
      if (realUrl && /^https?:\/\//.test(realUrl)) {
        return realUrl;
      }
    } catch {
      // Ignore URL parsing errors
    }
  }
  return null;
}

export function toSavedTab(tab: TabSnapshot, savedAt: string): SavedTab | null {
  const candidateUrl = tab.pendingUrl || tab.url;
  const url = extractWebUrl(candidateUrl);
  if (!url) return null;

  let hostname = url;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // Ignore malformed URLs; Chrome will still receive them when reopened.
  }

  let title = tab.title?.trim();
  let faviconUrl = tab.favIconUrl;

  // If tab is currently showing suspended placeholder, recover real title & favicon from URL params
  if (candidateUrl && candidateUrl.startsWith('chrome-extension://')) {
    try {
      const urlObj = new URL(candidateUrl);
      const paramTitle = urlObj.searchParams.get('title');
      const paramFavicon = urlObj.searchParams.get('favicon') || urlObj.searchParams.get('icon');
      if (paramTitle && (!title || title === 'Suspended Tab' || title === 'Saved Workspace Tab')) {
        title = paramTitle.trim();
      }
      if (paramFavicon && (!faviconUrl || faviconUrl.includes('chrome-extension://'))) {
        faviconUrl = paramFavicon;
      }
    } catch {
      // Ignore parsing errors
    }
  }

  return {
    id: createId('tab'),
    title: title || hostname,
    url,
    faviconUrl,
    hostname,
    savedAt,
  };
}

export function toSavedTabs(tabs: TabSnapshot[], savedAt = new Date().toISOString()): SavedTab[] {
  return tabs.map((tab) => toSavedTab(tab, savedAt)).filter((tab): tab is SavedTab => tab !== null);
}

function replaceWorkspace(store: WorkspaceStore, workspace: Workspace): WorkspaceStore {
  const workspaces = [...store.workspaces];
  const index = workspaces.findIndex((item) => item.id === workspace.id);

  if (index === -1) workspaces.push(workspace);
  else workspaces[index] = workspace;

  return { ...store, workspaces };
}

function unbindWindowsOf(store: WorkspaceStore, workspaceId: string): Record<string, string> {
  return Object.fromEntries(Object.entries(store.windowToWorkspace).filter(([, id]) => id !== workspaceId)) as Record<string, string>;
}

export function findWorkspaceByWindow(store: WorkspaceStore, windowId: number): Workspace | null {
  const workspaceId = store.windowToWorkspace[String(windowId)];
  return store.workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

/** Creates a live workspace that owns the window the tabs came from. */
export async function createLiveWorkspace(
  repository: WorkspaceRepository,
  input: { name: string; color: WorkspaceColor; windowId: number; tabs: TabSnapshot[]; isIncognito?: boolean },
): Promise<Workspace> {
  const name = input.name.trim();
  if (!name) throw new Error('Workspace name is required.');

  const now = new Date().toISOString();
  const workspace: Workspace = {
    id: createId('workspace'),
    name,
    color: input.color,
    tabs: toSavedTabs(input.tabs, now),
    live: { status: 'connected', windowId: input.windowId, isIncognito: input.isIncognito, lastSyncedAt: now },
    createdAt: now,
    updatedAt: now,
  };

  return repository.update((store) => ({
    store: replaceWorkspace(
      { ...store, windowToWorkspace: { ...unbindWindowsOf(store, workspace.id), [String(input.windowId)]: workspace.id } },
      workspace,
    ),
    result: workspace,
  }));
}

/** Mirrors the live contents of a window into the workspace that owns it. */
export async function syncWorkspaceFromWindow(
  repository: WorkspaceRepository,
  input: { windowId: number; tabs: TabSnapshot[]; isIncognito?: boolean },
): Promise<Workspace | null> {
  const now = new Date().toISOString();

  return repository.update((store) => {
    const workspace = findWorkspaceByWindow(store, input.windowId);
    if (!workspace) return { store, result: null };

    const newTabs = toSavedTabs(input.tabs, now);

    // Protection against transient empty/loading tab snapshots:
    // 1. If window has tabs, but toSavedTabs returned 0 web tabs (all loading / pending): keep existing tabs.
    // 2. If some tabs are still in 'loading' status and newTabs count is smaller than existing workspace tabs: keep existing tabs.
    const hasLoadingTabs = input.tabs.some((t) => t.status === 'loading' || (!t.url && !t.pendingUrl));
    let effectiveTabs = newTabs;

    if (input.tabs.length > 0 && newTabs.length === 0 && workspace.tabs.length > 0) {
      effectiveTabs = workspace.tabs;
    } else if (hasLoadingTabs && newTabs.length < workspace.tabs.length && workspace.tabs.length > 0) {
      effectiveTabs = workspace.tabs;
    }

    const updated: Workspace = {
      ...workspace,
      tabs: effectiveTabs,
      live: {
        status: 'connected',
        windowId: input.windowId,
        isIncognito: input.isIncognito ?? workspace.live.isIncognito,
        lastSyncedAt: now,
      },
      updatedAt: now,
    };

    return { store: replaceWorkspace(store, updated), result: updated };
  });
}

export async function bindWindowToWorkspace(
  repository: WorkspaceRepository,
  input: { workspaceId: string; windowId: number; isIncognito?: boolean },
): Promise<void> {
  const now = new Date().toISOString();

  await repository.update((store) => {
    const workspace = store.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace) return { store, result: undefined };

    const bound = {
      ...store,
      windowToWorkspace: { ...unbindWindowsOf(store, input.workspaceId), [String(input.windowId)]: input.workspaceId },
    };

    return {
      store: replaceWorkspace(bound, {
        ...workspace,
        live: {
          status: 'connected',
          windowId: input.windowId,
          isIncognito: input.isIncognito,
          lastSyncedAt: now,
        },
        updatedAt: now,
      }),
      result: undefined,
    };
  });
}

/** Keeps the last known tabs but marks the workspace as no longer open. */
export async function disconnectWindow(repository: WorkspaceRepository, windowId: number): Promise<void> {
  await repository.update((store) => {
    const workspace = findWorkspaceByWindow(store, windowId);
    const windowToWorkspace = Object.fromEntries(
      Object.entries(store.windowToWorkspace).filter(([id]) => id !== String(windowId)),
    );
    if (!workspace) return { store: { ...store, windowToWorkspace }, result: undefined };

    return {
      store: replaceWorkspace({ ...store, windowToWorkspace }, { ...workspace, live: { status: 'disconnected', lastSyncedAt: workspace.live.lastSyncedAt } }),
      result: undefined,
    };
  });
}

/** Drops window links whose Chrome windows no longer exist, e.g. after a restart. */
export async function reconcileOpenWindows(repository: WorkspaceRepository, openWindowIds: number[]): Promise<void> {
  const open = new Set(openWindowIds.map(String));

  await repository.update((store) => {
    const windowToWorkspace = Object.fromEntries(
      Object.entries(store.windowToWorkspace).filter(([windowId]) => open.has(windowId)),
    );
    const stillLive = new Set(Object.values(windowToWorkspace));

    return {
      store: {
        ...store,
        windowToWorkspace,
        workspaces: store.workspaces.map((workspace) =>
          workspace.live.status === 'connected' && !stillLive.has(workspace.id)
            ? { ...workspace, live: { status: 'disconnected', lastSyncedAt: workspace.live.lastSyncedAt } }
            : workspace,
        ),
      },
      result: undefined,
    };
  });
}

export async function updateWorkspaceMetadata(
  repository: WorkspaceRepository,
  input: { id: string; name: string; color: WorkspaceColor },
): Promise<Workspace> {
  const name = input.name.trim();
  if (!name) throw new Error('Workspace name is required.');

  const workspace = await repository.get(input.id);
  if (!workspace) throw new Error('Workspace not found.');

  const updated = { ...workspace, name, color: input.color, updatedAt: new Date().toISOString() };
  await repository.save(updated);
  return updated;
}

export function filterWorkspaces(workspaces: Workspace[], query: string): Workspace[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return workspaces;

  return workspaces.filter((workspace) =>
    [workspace.name, ...workspace.tabs.flatMap((tab) => [tab.title, tab.url, tab.hostname])]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalized),
  );
}

export function mergeSavedTabs(localTabs: SavedTab[], cloudTabs: SavedTab[]): SavedTab[] {
  const merged: SavedTab[] = [...localTabs];

  const localUrlCounts = new Map<string, number>();
  for (const tab of localTabs) {
    if (tab.url) {
      localUrlCounts.set(tab.url, (localUrlCounts.get(tab.url) || 0) + 1);
    }
  }

  const matchedCloudCounts = new Map<string, number>();

  for (const cloudTab of cloudTabs) {
    if (!cloudTab.url) continue;

    const availableLocal = localUrlCounts.get(cloudTab.url) || 0;
    const consumed = matchedCloudCounts.get(cloudTab.url) || 0;

    if (consumed < availableLocal) {
      matchedCloudCounts.set(cloudTab.url, consumed + 1);
    } else {
      merged.push(cloudTab);
    }
  }

  return merged;
}

function mergeWorkspaceHistories(
  localHistory: WorkspaceHistoryEntry[] = [],
  cloudHistory: WorkspaceHistoryEntry[] = []
): WorkspaceHistoryEntry[] {
  const seen = new Set<string>();
  const combined: WorkspaceHistoryEntry[] = [];

  for (const item of [...localHistory, ...cloudHistory]) {
    const key = `${item.url}_${item.timestamp}_${item.eventType}`;
    if (!seen.has(key)) {
      seen.add(key);
      combined.push(item);
    }
  }

  combined.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return combined.slice(0, MAX_WORKSPACE_HISTORY);
}

export const MAX_WORKSPACE_HISTORY = 200;

export function trimWorkspaceHistory(
  history: WorkspaceHistoryEntry[],
  maxLimit = MAX_WORKSPACE_HISTORY
): WorkspaceHistoryEntry[] {
  return history.slice(0, maxLimit);
}

export async function recordWorkspaceHistoryBatch(
  repository: WorkspaceRepository,
  workspaceId: string,
  entries: Array<Omit<WorkspaceHistoryEntry, 'id'>>
): Promise<Workspace> {
  const store = await repository.read();
  const workspace = store.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) throw new Error('Workspace not found.');

  const newEntries: WorkspaceHistoryEntry[] = entries.map((entry) => ({
    id: createId('hist'),
    ...entry,
  }));

  const existingHistory = Array.isArray(workspace.history) ? workspace.history : [];
  const updatedHistory = trimWorkspaceHistory([...newEntries, ...existingHistory]);

  const updatedWorkspace: Workspace = {
    ...workspace,
    history: updatedHistory,
    updatedAt: new Date().toISOString(),
  };

  await repository.replace(replaceWorkspace(store, updatedWorkspace));
  return updatedWorkspace;
}

export async function clearWorkspaceHistory(
  repository: WorkspaceRepository,
  workspaceId: string
): Promise<Workspace> {
  const store = await repository.read();
  const workspace = store.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) throw new Error('Workspace not found.');

  const updatedWorkspace: Workspace = {
    ...workspace,
    history: [],
    updatedAt: new Date().toISOString(),
  };

  await repository.replace(replaceWorkspace(store, updatedWorkspace));
  return updatedWorkspace;
}

export function mergeWorkspaceStores(
  localStore: WorkspaceStore,
  cloudStore: WorkspaceStore | null | undefined
): WorkspaceStore {
  if (!cloudStore || !Array.isArray(cloudStore.workspaces)) {
    return localStore;
  }

  const workspaceMap = new Map<string, Workspace>();

  for (const workspace of localStore.workspaces) {
    workspaceMap.set(workspace.id, workspace);
  }

  for (const cloudWs of cloudStore.workspaces) {
    const localWs = workspaceMap.get(cloudWs.id);
    if (!localWs) {
      // New workspace from cloud, set local live status to disconnected
      workspaceMap.set(cloudWs.id, {
        ...cloudWs,
        history: Array.isArray(cloudWs.history) ? cloudWs.history : [],
        live: { status: 'disconnected' },
      });
    } else {
      const localTime = localWs.updatedAt || localWs.createdAt || '';
      const cloudTime = cloudWs.updatedAt || cloudWs.createdAt || '';
      const mergedHistory = mergeWorkspaceHistories(localWs.history, cloudWs.history);

      if (cloudTime.localeCompare(localTime) > 0) {
        // Cloud is strictly newer: use cloud name, color, and tabs
        // If local is currently connected/live, merge tabs so live unsaved tabs aren't lost before syncing with Chrome window
        const isLive = localWs.live.status === 'connected';
        const mergedTabs = isLive ? mergeSavedTabs(localWs.tabs, cloudWs.tabs) : cloudWs.tabs;

        workspaceMap.set(cloudWs.id, {
          ...localWs,
          name: cloudWs.name,
          color: cloudWs.color,
          tabs: mergedTabs,
          history: mergedHistory,
          updatedAt: cloudTime,
        });
      } else if (localTime.localeCompare(cloudTime) > 0) {
        // Local is strictly newer: preserve local workspace (including any tab deletions)
        workspaceMap.set(cloudWs.id, {
          ...localWs,
          history: mergedHistory,
        });
      } else {
        // Timestamps equal or missing (initial sync): union tabs so no tab from local or cloud is lost initially
        const mergedTabs = mergeSavedTabs(localWs.tabs, cloudWs.tabs);
        workspaceMap.set(cloudWs.id, {
          ...localWs,
          tabs: mergedTabs,
          history: mergedHistory,
        });
      }
    }
  }

  const mergedWorkspaces = Array.from(workspaceMap.values()).sort((a, b) =>
    (b.updatedAt || '').localeCompare(a.updatedAt || '')
  );

  return {
    schemaVersion: 2,
    workspaces: mergedWorkspaces,
    windowToWorkspace: localStore.windowToWorkspace || {},
  };
}

