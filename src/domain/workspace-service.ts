import type { SavedTab, TabSnapshot, Workspace, WorkspaceColor, WorkspaceHistoryEntry, WorkspaceStore, WorkspaceTreeNode } from '@/src/domain/workspace';
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
  input: { windowId: number; tabs: TabSnapshot[]; isIncognito?: boolean; allowMassDrop?: boolean },
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

    // Mass Tab Drop Protection:
    // If tabs in the window suddenly decrease significantly (e.g. >= 4 tabs and >= 25% of total),
    // and this is not an explicitly approved drop:
    // 1. DO NOT drop tabs from workspace.tabs.
    // 2. Lock synchronization and record massDropWarning.
    // 3. Automatically record a rescue session_snapshot into history.
    const previousCount = workspace.tabs.length;
    const droppedCount = previousCount - newTabs.length;
    const isMassDrop =
      !input.allowMassDrop &&
      !workspace.live.syncLocked &&
      previousCount >= 5 &&
      droppedCount >= 4 &&
      droppedCount / previousCount >= 0.25;

    let updatedLive = {
      ...workspace.live,
      status: 'connected' as const,
      windowId: input.windowId,
      isIncognito: input.isIncognito ?? workspace.live.isIncognito,
      lastSyncedAt: now,
    };

    let updatedHistory = workspace.history;

    if (isMassDrop) {
      effectiveTabs = workspace.tabs; // Preserve original saved tabs!
      const openUrls = new Set(newTabs.map((t) => t.url));
      const missingTabs = workspace.tabs
        .filter((t) => !openUrls.has(t.url))
        .map((t) => ({ url: t.url, title: t.title, faviconUrl: t.faviconUrl }));

      updatedLive = {
        ...updatedLive,
        syncLocked: true,
        massDropWarning: {
          detectedAt: now,
          previousCount,
          currentCount: newTabs.length,
          droppedCount,
          missingTabs,
        },
      };

      const rescueSnapshot: WorkspaceHistoryEntry = {
        id: createId('hist'),
        url: workspace.tabs[0]?.url || 'workspace://window',
        title: `Mass drop protection snapshot (${previousCount} tabs preserved)`,
        faviconUrl: workspace.tabs[0]?.faviconUrl,
        hostname: `${previousCount} tabs`,
        timestamp: now,
        eventType: 'session_snapshot',
        tabCount: previousCount,
        isIncognito: Boolean(input.isIncognito ?? workspace.live.isIncognito),
        tabsSnapshot: workspace.tabs.map((t) => ({
          title: t.title,
          url: t.url,
          faviconUrl: t.faviconUrl,
        })),
      };
      updatedHistory = [rescueSnapshot, ...(workspace.history || [])].slice(0, MAX_WORKSPACE_HISTORY);
    } else if (workspace.live.syncLocked && !input.allowMassDrop) {
      // Sync is currently locked: keep workspace tabs protected
      effectiveTabs = workspace.tabs;
      if (updatedLive.massDropWarning) {
        updatedLive.massDropWarning = {
          ...updatedLive.massDropWarning,
          currentCount: newTabs.length,
        };
      }
    } else if (input.allowMassDrop) {
      // Explicitly allowed: clear locks
      updatedLive.syncLocked = false;
      updatedLive.massDropWarning = undefined;
    }

    const updated: Workspace = {
      ...workspace,
      tabs: effectiveTabs,
      history: updatedHistory,
      live: updatedLive,
      updatedAt: now,
    };

    return { store: replaceWorkspace(store, updated), result: updated };
  });
}

export async function resolveMassDrop(
  repository: WorkspaceRepository,
  input: {
    workspaceId: string;
    action: 'restore_missing' | 'accept_current';
    currentTabs?: TabSnapshot[];
  },
): Promise<{ workspace: Workspace; missingTabsToRestore?: Array<{ url: string; title: string; faviconUrl?: string }> }> {
  const now = new Date().toISOString();

  return repository.update<{
    workspace: Workspace;
    missingTabsToRestore?: Array<{ url: string; title: string; faviconUrl?: string }>;
  }>((store) => {
    const workspace = store.workspaces.find((w) => w.id === input.workspaceId);
    if (!workspace) throw new Error('Workspace not found.');

    const warning = workspace.live.massDropWarning;
    const missingTabs = warning?.missingTabs || [];

    if (input.action === 'restore_missing') {
      const updated: Workspace = {
        ...workspace,
        live: {
          ...workspace.live,
          syncLocked: false,
          massDropWarning: undefined,
          lastSyncedAt: now,
        },
        updatedAt: now,
      };
      return {
        store: replaceWorkspace(store, updated),
        result: { workspace: updated, missingTabsToRestore: missingTabs },
      };
    } else {
      let effectiveTabs = workspace.tabs;
      if (input.currentTabs) {
        effectiveTabs = toSavedTabs(input.currentTabs, now);
      }
      const updated: Workspace = {
        ...workspace,
        tabs: effectiveTabs,
        live: {
          ...workspace.live,
          syncLocked: false,
          massDropWarning: undefined,
          lastSyncedAt: now,
        },
        updatedAt: now,
      };
      return {
        store: replaceWorkspace(store, updated),
        result: { workspace: updated, missingTabsToRestore: undefined },
      };
    }
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

export async function deleteWorkspace(
  repository: WorkspaceRepository,
  workspaceId: string
): Promise<{ deletedIds: string[] }> {
  const store = await repository.read();
  const target = store.workspaces.find((w) => w.id === workspaceId);
  if (!target) return { deletedIds: [] };

  const now = new Date().toISOString();
  // Find target workspace and all its child workspaces
  const childWorkspaces = store.workspaces.filter((w) => w.parentId === workspaceId);
  const idsToDelete = new Set<string>([workspaceId, ...childWorkspaces.map((c) => c.id)]);

  const updatedWorkspaces = store.workspaces.filter((w) => !idsToDelete.has(w.id));
  const updatedWindowMap = Object.fromEntries(
    Object.entries(store.windowToWorkspace).filter(([, wsId]) => !idsToDelete.has(wsId))
  );

  const updatedDeletedWorkspaces = { ...(store.deletedWorkspaces || {}) };
  for (const id of idsToDelete) {
    updatedDeletedWorkspaces[id] = now;
  }

  await repository.replace({
    ...store,
    windowToWorkspace: updatedWindowMap,
    deletedWorkspaces: updatedDeletedWorkspaces,
    workspaces: updatedWorkspaces,
  });

  return { deletedIds: Array.from(idsToDelete) };
}

export function mergeWorkspaceStores(
  localStore: WorkspaceStore,
  cloudStore: WorkspaceStore | null | undefined
): WorkspaceStore {
  if (!cloudStore || !Array.isArray(cloudStore.workspaces)) {
    return localStore;
  }

  const nowMs = Date.now();
  const maxAgeMs = 60 * 24 * 60 * 60 * 1000; // Purge tombstones older than 60 days

  // Merge deletedWorkspaces records from both local and cloud
  const mergedDeleted: Record<string, string> = {};
  const allDeletedSources = [localStore.deletedWorkspaces, cloudStore.deletedWorkspaces];
  for (const src of allDeletedSources) {
    if (src && typeof src === 'object') {
      for (const [id, time] of Object.entries(src)) {
        if (typeof time === 'string') {
          const deleteMs = new Date(time).getTime();
          if (nowMs - deleteMs < maxAgeMs) {
            if (!mergedDeleted[id] || time.localeCompare(mergedDeleted[id]) > 0) {
              mergedDeleted[id] = time;
            }
          }
        }
      }
    }
  }

  const workspaceMap = new Map<string, Workspace>();

  // Helper to check if a workspace is marked as deleted by a tombstone
  const isDeleted = (ws: Workspace): boolean => {
    const deletedTime = mergedDeleted[ws.id];
    if (!deletedTime) return false;
    const updateTime = ws.updatedAt || ws.createdAt || '';
    // If deleted timestamp is >= update timestamp, the workspace is deleted
    return updateTime.localeCompare(deletedTime) <= 0;
  };

  for (const workspace of localStore.workspaces) {
    if (!isDeleted(workspace)) {
      workspaceMap.set(workspace.id, workspace);
    }
  }

  for (const cloudWs of cloudStore.workspaces) {
    if (isDeleted(cloudWs)) {
      continue;
    }

    const localWs = workspaceMap.get(cloudWs.id);
    if (!localWs) {
      // New workspace from cloud, set local live status to disconnected
      workspaceMap.set(cloudWs.id, {
        ...cloudWs,
        parentId: cloudWs.parentId ?? null,
        history: Array.isArray(cloudWs.history) ? cloudWs.history : [],
        live: { status: 'disconnected' },
      });
    } else {
      const localTime = localWs.updatedAt || localWs.createdAt || '';
      const cloudTime = cloudWs.updatedAt || cloudWs.createdAt || '';
      const mergedHistory = mergeWorkspaceHistories(localWs.history, cloudWs.history);

      if (cloudTime.localeCompare(localTime) > 0) {
        // Cloud is strictly newer: use cloud name, color, parentId, and tabs
        const isLive = localWs.live.status === 'connected';
        const mergedTabs = isLive ? mergeSavedTabs(localWs.tabs, cloudWs.tabs) : cloudWs.tabs;

        workspaceMap.set(cloudWs.id, {
          ...localWs,
          name: cloudWs.name,
          color: cloudWs.color,
          parentId: cloudWs.parentId !== undefined ? cloudWs.parentId : (localWs.parentId ?? null),
          tabs: mergedTabs,
          history: mergedHistory,
          updatedAt: cloudTime,
        });
      } else if (localTime.localeCompare(cloudTime) > 0) {
        // Local is strictly newer: preserve local workspace
        workspaceMap.set(cloudWs.id, {
          ...localWs,
          parentId: localWs.parentId !== undefined ? localWs.parentId : (cloudWs.parentId ?? null),
          history: mergedHistory,
        });
      } else {
        // Timestamps equal or missing (initial sync): union tabs so no tab from local or cloud is lost initially
        const mergedTabs = mergeSavedTabs(localWs.tabs, cloudWs.tabs);
        workspaceMap.set(cloudWs.id, {
          ...localWs,
          parentId: localWs.parentId !== undefined ? localWs.parentId : (cloudWs.parentId ?? null),
          tabs: mergedTabs,
          history: mergedHistory,
        });
      }
    }
  }

  // If a workspace exists and its updatedAt is newer than its tombstone, keep it and remove tombstone
  for (const keptId of workspaceMap.keys()) {
    delete mergedDeleted[keptId];
  }

  const mergedWorkspaces = Array.from(workspaceMap.values()).sort((a, b) =>
    (b.updatedAt || '').localeCompare(a.updatedAt || '')
  );

  return {
    schemaVersion: 2,
    workspaces: mergedWorkspaces,
    windowToWorkspace: localStore.windowToWorkspace || {},
    deletedWorkspaces: mergedDeleted,
  };
}

export interface DuplicateTabGroup {
  url: string;
  title: string;
  hostname: string;
  faviconUrl?: string;
  count: number;
  redundantCount: number;
  tabIds: string[];
  tabs: SavedTab[];
}

/**
 * Finds all groups of tabs that have the same URL (count >= 2).
 */
export function getDuplicateTabGroups(tabs: SavedTab[]): DuplicateTabGroup[] {
  const urlMap = new Map<string, SavedTab[]>();

  for (const tab of tabs) {
    if (!tab.url) continue;
    const existing = urlMap.get(tab.url) || [];
    existing.push(tab);
    urlMap.set(tab.url, existing);
  }

  const groups: DuplicateTabGroup[] = [];

  for (const [url, groupTabs] of urlMap.entries()) {
    if (groupTabs.length >= 2) {
      const primary = groupTabs[0];
      if (!primary) continue;
      const title = groupTabs.find((t) => t.title && t.title !== t.url && t.title !== t.hostname)?.title || primary.title;
      const faviconUrl = groupTabs.find((t) => t.faviconUrl)?.faviconUrl || primary.faviconUrl;

      groups.push({
        url,
        title,
        hostname: primary.hostname,
        faviconUrl,
        count: groupTabs.length,
        redundantCount: groupTabs.length - 1,
        tabIds: groupTabs.map((t) => t.id),
        tabs: groupTabs,
      });
    }
  }

  // Sort groups by redundantCount descending (groups with most duplicates first)
  return groups.sort((a, b) => b.redundantCount - a.redundantCount);
}

/**
 * Deduplicates saved tabs by keeping the first occurrence of each URL.
 * If targetUrls is provided, only tabs matching those URLs are deduplicated;
 * other duplicate tabs remain untouched.
 */
export function deduplicateSavedTabs(
  tabs: SavedTab[],
  targetUrls?: string[] | Set<string>
): { remainingTabs: SavedTab[]; removedTabs: SavedTab[]; removedCount: number } {
  const targetSet = targetUrls ? (targetUrls instanceof Set ? targetUrls : new Set(targetUrls)) : null;
  const seenUrls = new Set<string>();
  const remainingTabs: SavedTab[] = [];
  const removedTabs: SavedTab[] = [];

  for (const tab of tabs) {
    if (!tab.url) {
      remainingTabs.push(tab);
      continue;
    }

    const shouldDeduplicate = !targetSet || targetSet.has(tab.url);

    if (shouldDeduplicate) {
      if (seenUrls.has(tab.url)) {
        removedTabs.push(tab);
      } else {
        seenUrls.add(tab.url);
        remainingTabs.push(tab);
      }
    } else {
      remainingTabs.push(tab);
    }
  }

  return {
    remainingTabs,
    removedTabs,
    removedCount: removedTabs.length,
  };
}

/**
 * Deduplicates tabs of a saved workspace in repository.
 */
export async function deduplicateWorkspace(
  repository: WorkspaceRepository,
  workspaceId: string,
  targetUrls?: string[]
): Promise<{ workspace: Workspace; removedCount: number; affectedGroups: number }> {
  const store = await repository.read();
  const workspace = store.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) throw new Error('Workspace not found.');

  const { remainingTabs, removedCount } = deduplicateSavedTabs(workspace.tabs, targetUrls);

  const affectedGroups = targetUrls ? targetUrls.length : getDuplicateTabGroups(workspace.tabs).length;
  const updatedWorkspace: Workspace = {
    ...workspace,
    tabs: remainingTabs,
    updatedAt: new Date().toISOString(),
  };

  await repository.replace(replaceWorkspace(store, updatedWorkspace));

  return {
    workspace: updatedWorkspace,
    removedCount,
    affectedGroups,
  };
}

/**
 * Adds new tabs to an existing workspace.
 */
export async function addTabsToWorkspace(
  repository: WorkspaceRepository,
  workspaceId: string,
  tabsToAdd: Array<{ url: string; title?: string; faviconUrl?: string }>
): Promise<{ workspace: Workspace; addedCount: number }> {
  const now = new Date().toISOString();
  const store = await repository.read();
  const workspace = store.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) throw new Error('Workspace not found.');

  const newSavedTabs: SavedTab[] = [];
  for (const item of tabsToAdd) {
    const rawUrl = extractWebUrl(item.url);
    if (!rawUrl) continue;

    let hostname = rawUrl;
    try {
      hostname = new URL(rawUrl).hostname.replace(/^www\./, '');
    } catch {
      // Ignore malformed hostname
    }

    newSavedTabs.push({
      id: createId('tab'),
      title: item.title?.trim() || hostname,
      url: rawUrl,
      faviconUrl: item.faviconUrl,
      hostname,
      savedAt: now,
    });
  }

  if (newSavedTabs.length === 0) {
    return { workspace, addedCount: 0 };
  }

  const updatedWorkspace: Workspace = {
    ...workspace,
    tabs: [...workspace.tabs, ...newSavedTabs],
    updatedAt: now,
  };

  await repository.replace(replaceWorkspace(store, updatedWorkspace));

  return {
    workspace: updatedWorkspace,
    addedCount: newSavedTabs.length,
  };
}

/**
 * Builds a hierarchical tree node structure for workspaces.
 */
export function buildWorkspaceTree(workspaces: Workspace[]): WorkspaceTreeNode[] {
  const topLevel = workspaces.filter((w) => !w.parentId);
  const childrenMap = new Map<string, Workspace[]>();

  for (const w of workspaces) {
    if (w.parentId) {
      const list = childrenMap.get(w.parentId) || [];
      list.push(w);
      childrenMap.set(w.parentId, list);
    }
  }

  return topLevel.map((parent) => {
    const children = (childrenMap.get(parent.id) || []).sort((a, b) =>
      (a.createdAt || '').localeCompare(b.createdAt || '')
    );
    const totalTabsCount = parent.tabs.length + children.reduce((sum, c) => sum + c.tabs.length, 0);
    const hasLive =
      (parent.live.status === 'connected' && parent.live.windowId !== undefined) ||
      children.some((c) => c.live.status === 'connected' && c.live.windowId !== undefined);

    return {
      workspace: parent,
      children,
      totalTabsCount,
      totalChildCount: children.length,
      hasLive,
    };
  });
}

export function getAllDescendantWorkspaces(workspaces: Workspace[], rootId: string): Workspace[] {
  return workspaces.filter((w) => w.parentId === rootId);
}

export interface TreeTabItem extends SavedTab {
  workspaceId: string;
  workspaceName: string;
  isParent: boolean;
}

export function getAllTabsInTree(workspaces: Workspace[], rootId: string): TreeTabItem[] {
  const parent = workspaces.find((w) => w.id === rootId);
  const children = workspaces.filter((w) => w.parentId === rootId);
  const result: TreeTabItem[] = [];

  if (parent) {
    for (const tab of parent.tabs) {
      result.push({
        ...tab,
        workspaceId: parent.id,
        workspaceName: parent.name,
        isParent: true,
      });
    }
  }

  for (const child of children) {
    for (const tab of child.tabs) {
      result.push({
        ...tab,
        workspaceId: child.id,
        workspaceName: child.name,
        isParent: false,
      });
    }
  }

  return result;
}

export interface SplitWorkspaceParams {
  parentWorkspaceId: string;
  splitMode: 'by_tab_count' | 'by_child_count';
  value: number;
  childNamePrefix?: string;
  colors?: WorkspaceColor[];
  moveTabs?: boolean;
}

export interface SplitWorkspaceResult {
  parent: Workspace;
  children: Workspace[];
}

export async function splitWorkspace(
  repository: WorkspaceRepository,
  params: SplitWorkspaceParams
): Promise<SplitWorkspaceResult> {
  const now = new Date().toISOString();
  const store = await repository.read();
  const parent = store.workspaces.find((w) => w.id === params.parentWorkspaceId);
  if (!parent) throw new Error('Parent workspace not found.');

  if (parent.parentId) {
    throw new Error('Chỉ có thể chia đều tab từ Workspace Gốc (Root Workspace). Không thể tách tiếp workspace con.');
  }

  const totalTabs = parent.tabs.length;
  if (totalTabs === 0) {
    throw new Error('Workspace không có tab nào để chia.');
  }

  let chunkSize = 1;
  let childCount = 1;

  if (params.splitMode === 'by_tab_count') {
    chunkSize = Math.max(1, Math.floor(params.value));
    childCount = Math.ceil(totalTabs / chunkSize);
  } else {
    childCount = Math.max(1, Math.min(totalTabs, Math.floor(params.value)));
    chunkSize = Math.ceil(totalTabs / childCount);
  }

  const chunks: SavedTab[][] = [];
  for (let i = 0; i < totalTabs; i += chunkSize) {
    chunks.push(parent.tabs.slice(i, i + chunkSize));
  }

  const prefix = params.childNamePrefix?.trim() || `${parent.name} - Phần`;
  const palette: WorkspaceColor[] = ['indigo', 'sky', 'teal', 'emerald', 'amber', 'orange', 'rose', 'violet'];
  const newChildren: Workspace[] = [];

  chunks.forEach((chunk, index) => {
    const colorIndex = ((palette.indexOf(parent.color) + index + 1) % palette.length);
    const color: WorkspaceColor =
      (params.colors && params.colors[index % params.colors.length]) ||
      palette[colorIndex >= 0 ? colorIndex : 0] ||
      'indigo';
    const childWs: Workspace = {
      id: createId('ws_child'),
      name: `${prefix} ${index + 1}`,
      color,
      parentId: parent.id,
      tabs: chunk,
      history: [],
      live: { status: 'disconnected' },
      createdAt: new Date(Date.now() + index * 50).toISOString(),
      updatedAt: now,
    };
    newChildren.push(childWs);
  });

  const updatedParent: Workspace = {
    ...parent,
    tabs: params.moveTabs === false ? parent.tabs : [],
    updatedAt: now,
  };

  const updatedWorkspaces = store.workspaces
    .map((w) => (w.id === parent.id ? updatedParent : w))
    .concat(newChildren);

  await repository.replace({
    ...store,
    workspaces: updatedWorkspaces,
  });

  return {
    parent: updatedParent,
    children: newChildren,
  };
}

export async function mergeChildrenToParent(
  repository: WorkspaceRepository,
  parentWorkspaceId: string,
  deleteChildren = true
): Promise<{ parent: Workspace; mergedTabsCount: number; affectedChildrenCount: number }> {
  const now = new Date().toISOString();
  const store = await repository.read();
  const parent = store.workspaces.find((w) => w.id === parentWorkspaceId);
  if (!parent) throw new Error('Parent workspace not found.');

  const children = store.workspaces.filter((w) => w.parentId === parentWorkspaceId);
  if (children.length === 0) {
    return { parent, mergedTabsCount: 0, affectedChildrenCount: 0 };
  }

  const collectedTabs: SavedTab[] = [];
  for (const child of children) {
    collectedTabs.push(...child.tabs);
  }

  const mergedTabs = [...parent.tabs, ...collectedTabs];
  const updatedParent: Workspace = {
    ...parent,
    tabs: mergedTabs,
    updatedAt: now,
  };

  let newWorkspaces: Workspace[];
  const updatedDeletedWorkspaces = { ...(store.deletedWorkspaces || {}) };

  if (deleteChildren) {
    const childIds = new Set(children.map((c) => c.id));
    for (const child of children) {
      updatedDeletedWorkspaces[child.id] = now;
    }
    newWorkspaces = store.workspaces
      .filter((w) => !childIds.has(w.id))
      .map((w) => (w.id === parent.id ? updatedParent : w));
  } else {
    newWorkspaces = store.workspaces.map((w) => {
      if (w.id === parent.id) return updatedParent;
      if (w.parentId === parent.id) return { ...w, tabs: [], updatedAt: now };
      return w;
    });
  }

  await repository.replace({
    ...store,
    deletedWorkspaces: updatedDeletedWorkspaces,
    workspaces: newWorkspaces,
  });

  return {
    parent: updatedParent,
    mergedTabsCount: collectedTabs.length,
    affectedChildrenCount: children.length,
  };
}

export async function createChildWorkspace(
  repository: WorkspaceRepository,
  parentId: string,
  name: string,
  color?: WorkspaceColor,
  initialTabs?: Array<{ url: string; title?: string; faviconUrl?: string }>,
  removeTabsFromParent?: boolean
): Promise<Workspace> {
  const store = await repository.read();
  const parent = store.workspaces.find((w) => w.id === parentId);
  if (!parent) throw new Error('Parent workspace not found.');

  const now = new Date().toISOString();

  // Format initial tabs if any
  const formattedTabs: SavedTab[] = (initialTabs || [])
    .map((tabItem): SavedTab | null => {
      const cleanUrl = extractWebUrl(tabItem.url);
      if (!cleanUrl) return null;
      let hostname = cleanUrl;
      try {
        hostname = new URL(cleanUrl).hostname.replace(/^www\./, '');
      } catch {}
      return {
        id: createId('tab'),
        url: cleanUrl,
        title: tabItem.title?.trim() || hostname,
        hostname,
        faviconUrl: tabItem.faviconUrl,
        savedAt: now,
      };
    })
    .filter((tabItem): tabItem is SavedTab => tabItem !== null);

  const childWs: Workspace = {
    id: createId('ws_child'),
    name: name.trim() || `${parent.name} - Con`,
    color: color || parent.color,
    parentId: parent.id,
    tabs: formattedTabs,
    history: [],
    live: { status: 'disconnected' },
    createdAt: now,
    updatedAt: now,
  };

  let updatedParent = parent;
  if (removeTabsFromParent && formattedTabs.length > 0) {
    const urlsToRemove = new Set(formattedTabs.map((tabItem) => tabItem.url));
    updatedParent = {
      ...parent,
      tabs: parent.tabs.filter((tabItem) => !urlsToRemove.has(tabItem.url)),
      updatedAt: now,
    };
  }

  const updatedWorkspaces = store.workspaces
    .map((w) => (w.id === parent.id ? updatedParent : w))
    .concat(childWs);

  await repository.replace({
    ...store,
    workspaces: updatedWorkspaces,
  });

  return childWs;
}

export async function moveTabsBetweenWorkspaces(
  repository: WorkspaceRepository,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  tabIds: string[]
): Promise<{ source: Workspace; target: Workspace; movedCount: number }> {
  const store = await repository.read();
  const source = store.workspaces.find((w) => w.id === sourceWorkspaceId);
  const target = store.workspaces.find((w) => w.id === targetWorkspaceId);

  if (!source) throw new Error('Source workspace not found.');
  if (!target) throw new Error('Target workspace not found.');

  if (sourceWorkspaceId === targetWorkspaceId) {
    return { source, target, movedCount: 0 };
  }

  const now = new Date().toISOString();
  const tabIdSet = new Set(tabIds);
  const tabsToMove = source.tabs.filter((t) => tabIdSet.has(t.id));
  const remainingSourceTabs = source.tabs.filter((t) => !tabIdSet.has(t.id));

  if (tabsToMove.length === 0) {
    return { source, target, movedCount: 0 };
  }

  const updatedSource: Workspace = {
    ...source,
    tabs: remainingSourceTabs,
    updatedAt: now,
  };

  const updatedTarget: Workspace = {
    ...target,
    tabs: [...target.tabs, ...tabsToMove],
    updatedAt: now,
  };

  const newWorkspaces = store.workspaces.map((w) => {
    if (w.id === source.id) return updatedSource;
    if (w.id === target.id) return updatedTarget;
    return w;
  });

  await repository.replace({
    ...store,
    workspaces: newWorkspaces,
  });

  return {
    source: updatedSource,
    target: updatedTarget,
    movedCount: tabsToMove.length,
  };
}

export interface TreeDuplicateGroup {
  url: string;
  title: string;
  hostname: string;
  faviconUrl?: string;
  totalCount: number;
  redundantCount: number;
  occurrences: Array<{
    tabId: string;
    workspaceId: string;
    workspaceName: string;
    isParent: boolean;
  }>;
}

export function getTreeDuplicateTabGroups(workspaces: Workspace[], rootId: string): TreeDuplicateGroup[] {
  const allTabs = getAllTabsInTree(workspaces, rootId);
  const urlGroups = new Map<string, TreeTabItem[]>();

  for (const tab of allTabs) {
    if (!tab.url) continue;
    const list = urlGroups.get(tab.url) || [];
    list.push(tab);
    urlGroups.set(tab.url, list);
  }

  const duplicateGroups: TreeDuplicateGroup[] = [];

  for (const [url, tabList] of urlGroups.entries()) {
    if (tabList.length > 1 && tabList[0]) {
      const first = tabList[0];
      duplicateGroups.push({
        url,
        title: first.title || first.hostname || url,
        hostname: first.hostname,
        faviconUrl: first.faviconUrl,
        totalCount: tabList.length,
        redundantCount: tabList.length - 1,
        occurrences: tabList.map((t) => ({
          tabId: t.id,
          workspaceId: t.workspaceId,
          workspaceName: t.workspaceName,
          isParent: t.isParent,
        })),
      });
    }
  }

  return duplicateGroups.sort((a, b) => b.totalCount - a.totalCount || a.title.localeCompare(b.title));
}

export async function deduplicateWorkspaceTree(
  repository: WorkspaceRepository,
  rootId: string,
  targetUrls?: string[]
): Promise<{
  affectedWorkspacesCount: number;
  totalRemovedCount: number;
}> {
  const store = await repository.read();
  const parent = store.workspaces.find((w) => w.id === rootId);
  if (!parent) throw new Error('Root workspace not found.');

  const children = store.workspaces.filter((w) => w.parentId === rootId);
  const allTreeWorkspaces = [parent, ...children];
  const targetSet = targetUrls && targetUrls.length > 0 ? new Set(targetUrls) : null;

  const seenUrls = new Set<string>();
  let totalRemovedCount = 0;
  let affectedWorkspacesCount = 0;

  const now = new Date().toISOString();
  const updatedWorkspacesMap = new Map<string, Workspace>();

  for (const ws of allTreeWorkspaces) {
    const remainingTabs: SavedTab[] = [];
    let removedInThisWs = 0;

    for (const tab of ws.tabs) {
      if (!tab.url) {
        remainingTabs.push(tab);
        continue;
      }

      const shouldDeduplicate = !targetSet || targetSet.has(tab.url);

      if (shouldDeduplicate) {
        if (seenUrls.has(tab.url)) {
          removedInThisWs++;
          totalRemovedCount++;
        } else {
          seenUrls.add(tab.url);
          remainingTabs.push(tab);
        }
      } else {
        remainingTabs.push(tab);
      }
    }

    if (removedInThisWs > 0) {
      affectedWorkspacesCount++;
      updatedWorkspacesMap.set(ws.id, {
        ...ws,
        tabs: remainingTabs,
        updatedAt: now,
      });
    }
  }

  if (totalRemovedCount > 0) {
    const newWorkspaces = store.workspaces.map((w) => updatedWorkspacesMap.get(w.id) || w);
    await repository.replace({
      ...store,
      workspaces: newWorkspaces,
    });
  }

  return {
    affectedWorkspacesCount,
    totalRemovedCount,
  };
}


