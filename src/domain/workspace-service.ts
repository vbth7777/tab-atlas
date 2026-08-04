import type { SavedTab, TabSnapshot, Workspace, WorkspaceColor, WorkspaceStore } from '@/src/domain/workspace';
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
  const url = extractWebUrl(tab.url);
  if (!url) return null;

  let hostname = url;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // Ignore malformed URLs; Chrome will still receive them when reopened.
  }

  return {
    id: createId('tab'),
    title: tab.title?.trim() || hostname,
    url,
    faviconUrl: tab.favIconUrl,
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
  return Object.fromEntries(Object.entries(store.windowToWorkspace).filter(([, id]) => id !== workspaceId));
}

export function findWorkspaceByWindow(store: WorkspaceStore, windowId: number): Workspace | null {
  const workspaceId = store.windowToWorkspace[String(windowId)];
  return store.workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

/** Creates a live workspace that owns the window the tabs came from. */
export async function createLiveWorkspace(
  repository: WorkspaceRepository,
  input: { name: string; color: WorkspaceColor; windowId: number; tabs: TabSnapshot[] },
): Promise<Workspace> {
  const name = input.name.trim();
  if (!name) throw new Error('Workspace name is required.');

  const now = new Date().toISOString();
  const workspace: Workspace = {
    id: createId('workspace'),
    name,
    color: input.color,
    tabs: toSavedTabs(input.tabs, now),
    live: { status: 'connected', windowId: input.windowId, lastSyncedAt: now },
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
  input: { windowId: number; tabs: TabSnapshot[] },
): Promise<Workspace | null> {
  const now = new Date().toISOString();

  return repository.update((store) => {
    const workspace = findWorkspaceByWindow(store, input.windowId);
    if (!workspace) return { store, result: null };

    const updated: Workspace = {
      ...workspace,
      tabs: toSavedTabs(input.tabs, now),
      live: { status: 'connected', windowId: input.windowId, lastSyncedAt: now },
      updatedAt: now,
    };

    return { store: replaceWorkspace(store, updated), result: updated };
  });
}

export async function bindWindowToWorkspace(
  repository: WorkspaceRepository,
  input: { workspaceId: string; windowId: number },
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
        live: { status: 'connected', windowId: input.windowId, lastSyncedAt: now },
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
