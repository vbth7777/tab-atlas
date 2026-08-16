import { describe, expect, it } from 'vitest';
import {
  bindWindowToWorkspace,
  createLiveWorkspace,
  disconnectWindow,
  filterWorkspaces,
  mergeSavedTabs,
  mergeWorkspaceStores,
  reconcileOpenWindows,
  syncWorkspaceFromWindow,
  updateWorkspaceMetadata,
} from '@/src/domain/workspace-service';
import { EMPTY_STORE, type Workspace, type WorkspaceStore } from '@/src/domain/workspace';
import type { WorkspaceRepository } from '@/src/data/workspace-repository';

class MemoryRepository implements WorkspaceRepository {
  constructor(private store: WorkspaceStore = EMPTY_STORE) {}
  async read() { return this.store; }
  async list() { return [...this.store.workspaces]; }
  async get(id: string) { return this.store.workspaces.find((workspace) => workspace.id === id) ?? null; }
  async save(workspace: WorkspaceStore['workspaces'][number]) {
    this.store = { ...this.store, workspaces: [...this.store.workspaces.filter((item) => item.id !== workspace.id), workspace] };
  }
  async remove(id: string) { this.store = { ...this.store, workspaces: this.store.workspaces.filter((workspace) => workspace.id !== id) }; }
  async replace(store: WorkspaceStore) { this.store = store; }
  async update<T>(mutator: (store: WorkspaceStore) => { store: WorkspaceStore; result: T }) {
    const { store, result } = mutator(this.store);
    this.store = store;
    return result;
  }
}

const tab = (id: number, url: string, title = url) => ({ id, url, title });

describe('live workspaces', () => {
  it('binds the originating window and keeps only web tabs', async () => {
    const repository = new MemoryRepository();
    const workspace = await createLiveWorkspace(repository, {
      name: 'Research',
      color: 'teal',
      windowId: 11,
      tabs: [tab(1, 'https://developer.mozilla.org/docs', 'Web APIs | MDN'), tab(2, 'chrome://extensions', 'Extensions')],
    });

    expect(workspace.tabs).toHaveLength(1);
    expect(workspace.tabs.at(0)).toMatchObject({ hostname: 'developer.mozilla.org' });
    expect(workspace.live).toMatchObject({ status: 'connected', windowId: 11 });
    expect((await repository.read()).windowToWorkspace).toEqual({ '11': workspace.id });
  });

  it('mirrors added and removed tabs into the owning workspace', async () => {
    const repository = new MemoryRepository();
    const workspace = await createLiveWorkspace(repository, { name: 'Reading', color: 'indigo', windowId: 7, tabs: [tab(1, 'https://example.com/a')] });

    const synced = await syncWorkspaceFromWindow(repository, { windowId: 7, tabs: [tab(1, 'https://example.com/a'), tab(2, 'https://example.com/b')] });
    expect(synced?.tabs.map((item) => item.url)).toEqual(['https://example.com/a', 'https://example.com/b']);

    const afterClose = await syncWorkspaceFromWindow(repository, { windowId: 7, tabs: [tab(2, 'https://example.com/b')] });
    expect(afterClose?.tabs.map((item) => item.url)).toEqual(['https://example.com/b']);
    expect(afterClose?.id).toBe(workspace.id);
  });

  it('ignores windows that no workspace owns', async () => {
    const repository = new MemoryRepository();
    await createLiveWorkspace(repository, { name: 'Owned', color: 'sky', windowId: 3, tabs: [tab(1, 'https://example.com/a')] });

    expect(await syncWorkspaceFromWindow(repository, { windowId: 99, tabs: [tab(9, 'https://other.com')] })).toBeNull();
    expect((await repository.get((await repository.list())[0]!.id))?.tabs).toHaveLength(1);
  });

  it('keeps the last tabs when the window closes and can be reopened later', async () => {
    const repository = new MemoryRepository();
    const workspace = await createLiveWorkspace(repository, { name: 'Sprint', color: 'rose', windowId: 4, tabs: [tab(1, 'https://example.com/a')] });

    await disconnectWindow(repository, 4);
    const closed = await repository.get(workspace.id);
    expect(closed?.live.status).toBe('disconnected');
    expect(closed?.tabs).toHaveLength(1);
    expect((await repository.read()).windowToWorkspace).toEqual({});

    await bindWindowToWorkspace(repository, { workspaceId: workspace.id, windowId: 21 });
    expect((await repository.get(workspace.id))?.live).toMatchObject({ status: 'connected', windowId: 21 });
  });

  it('drops window links that no longer exist after a restart', async () => {
    const repository = new MemoryRepository();
    const stale = await createLiveWorkspace(repository, { name: 'Yesterday', color: 'amber', windowId: 5, tabs: [tab(1, 'https://example.com/a')] });
    const open = await createLiveWorkspace(repository, { name: 'Today', color: 'violet', windowId: 6, tabs: [tab(2, 'https://example.com/b')] });

    await reconcileOpenWindows(repository, [6]);

    expect((await repository.get(stale.id))?.live.status).toBe('disconnected');
    expect((await repository.get(open.id))?.live).toMatchObject({ status: 'connected', windowId: 6 });
  });

  it('renames a workspace and finds it by a tracked URL', async () => {
    const repository = new MemoryRepository();
    const workspace = await createLiveWorkspace(repository, { name: 'Reading', color: 'indigo', windowId: 2, tabs: [tab(1, 'https://example.com/releases', 'Release notes')] });
    const updated = await updateWorkspaceMetadata(repository, { id: workspace.id, name: 'Product reading', color: 'rose' });

    expect(updated).toMatchObject({ name: 'Product reading', color: 'rose' });
    expect(filterWorkspaces([updated], 'example.com')).toEqual([updated]);
  });

  it('supports creating, binding, and syncing incognito live workspaces', async () => {
    const repository = new MemoryRepository();
    const incognitoWs = await createLiveWorkspace(repository, {
      name: 'Private Research',
      color: 'violet',
      windowId: 88,
      tabs: [tab(1, 'https://example.com/secret')],
      isIncognito: true,
    });

    expect(incognitoWs.live).toMatchObject({ status: 'connected', windowId: 88, isIncognito: true });

    // Syncing tabs preserves isIncognito status
    const synced = await syncWorkspaceFromWindow(repository, {
      windowId: 88,
      tabs: [tab(1, 'https://example.com/secret'), tab(2, 'https://example.com/docs')],
    });
    expect(synced?.live).toMatchObject({ status: 'connected', windowId: 88, isIncognito: true });
    expect(synced?.tabs).toHaveLength(2);

    // Disconnect and rebind in incognito mode
    await disconnectWindow(repository, 88);
    await bindWindowToWorkspace(repository, { workspaceId: incognitoWs.id, windowId: 99, isIncognito: true });
    const rebound = await repository.get(incognitoWs.id);
    expect(rebound?.live).toMatchObject({ status: 'connected', windowId: 99, isIncognito: true });
  });

  it('preserves existing workspace tabs when tabs in window are still loading with empty URLs', async () => {
    const repository = new MemoryRepository();
    const workspace = await createLiveWorkspace(repository, {
      name: 'Important Research',
      color: 'sky',
      windowId: 50,
      tabs: [tab(1, 'https://example.com/a'), tab(2, 'https://example.com/b')],
    });

    // Window reports tabs with status 'loading' and no committed URL yet
    const synced = await syncWorkspaceFromWindow(repository, {
      windowId: 50,
      tabs: [
        { id: 101, status: 'loading', url: '' },
        { id: 102, status: 'loading', url: '' },
      ],
    });

    // Saved tabs must NOT be wiped to 0
    expect(synced?.tabs).toHaveLength(2);
    expect(synced?.tabs.map((t) => t.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('correctly extracts URL from pendingUrl when tab is navigating', async () => {
    const repository = new MemoryRepository();
    const workspace = await createLiveWorkspace(repository, {
      name: 'Navigation Test',
      color: 'emerald',
      windowId: 60,
      tabs: [],
    });

    const synced = await syncWorkspaceFromWindow(repository, {
      windowId: 60,
      tabs: [
        { id: 201, status: 'loading', url: '', pendingUrl: 'https://developer.mozilla.org/en-US/' },
      ],
    });

    expect(synced?.tabs).toHaveLength(1);
    expect(synced?.tabs[0]!.url).toBe('https://developer.mozilla.org/en-US/');
  });

  it('correctly extracts real web URL, title, and favicon from extension suspended URLs', async () => {
    const repository = new MemoryRepository();
    const workspace = await createLiveWorkspace(repository, {
      name: 'Suspended Tabs Workspace',
      color: 'amber',
      windowId: 70,
      tabs: [],
    });

    const suspendedUrl = 'chrome-extension://fakeid123/suspended.html?url=https%3A%2F%2Fgithub.com%2Ftrending&title=GitHub+Trending&favicon=https%3A%2F%2Fgithub.com%2Ffavicon.ico';
    const synced = await syncWorkspaceFromWindow(repository, {
      windowId: 70,
      tabs: [
        { id: 301, url: suspendedUrl, title: 'Suspended Tab' },
      ],
    });

    expect(synced?.tabs).toHaveLength(1);
    expect(synced?.tabs[0]!.url).toBe('https://github.com/trending');
    expect(synced?.tabs[0]!.hostname).toBe('github.com');
    expect(synced?.tabs[0]!.title).toBe('GitHub Trending');
    expect(synced?.tabs[0]!.faviconUrl).toBe('https://github.com/favicon.ico');
  });
});

describe('mergeWorkspaceStores', () => {
  const ws1: Workspace = {
    id: 'ws_1',
    name: 'Local Only',
    color: 'teal',
    tabs: [],
    live: { status: 'connected', windowId: 10 },
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
  };

  const ws2Local: Workspace = {
    id: 'ws_2',
    name: 'Shared Workspace (Local Version)',
    color: 'sky',
    tabs: [],
    live: { status: 'connected', windowId: 12 },
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T12:00:00Z',
  };

  const ws2CloudNewer: Workspace = {
    id: 'ws_2',
    name: 'Shared Workspace (Cloud Updated Version)',
    color: 'rose',
    tabs: [],
    live: { status: 'disconnected' },
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-02T15:00:00Z',
  };

  const ws3Cloud: Workspace = {
    id: 'ws_3',
    name: 'Cloud Only',
    color: 'amber',
    tabs: [],
    live: { status: 'connected', windowId: 99 },
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T11:00:00Z',
  };

  it('combines local and cloud workspaces into a union', () => {
    const localStore: WorkspaceStore = { schemaVersion: 2, workspaces: [ws1], windowToWorkspace: { '10': 'ws_1' } };
    const cloudStore: WorkspaceStore = { schemaVersion: 2, workspaces: [ws3Cloud], windowToWorkspace: {} };

    const merged = mergeWorkspaceStores(localStore, cloudStore);
    expect(merged.workspaces).toHaveLength(2);
    expect(merged.workspaces.map((w) => w.id)).toContain('ws_1');
    expect(merged.workspaces.map((w) => w.id)).toContain('ws_3');
    // Remote cloud workspace live status should be reset to disconnected for local session
    expect(merged.workspaces.find((w) => w.id === 'ws_3')?.live.status).toBe('disconnected');
  });

  it('resolves conflicts using latest updatedAt timestamp and preserves local live connection', () => {
    const localStore: WorkspaceStore = { schemaVersion: 2, workspaces: [ws2Local], windowToWorkspace: { '12': 'ws_2' } };
    const cloudStore: WorkspaceStore = { schemaVersion: 2, workspaces: [ws2CloudNewer], windowToWorkspace: {} };

    const merged = mergeWorkspaceStores(localStore, cloudStore);
    expect(merged.workspaces).toHaveLength(1);
    const resultWs = merged.workspaces[0]!;
    // Cloud title wins because cloud updatedAt is newer
    expect(resultWs.name).toBe('Shared Workspace (Cloud Updated Version)');
    // But local live connection windowId 12 is preserved!
    expect(resultWs.live).toEqual({ status: 'connected', windowId: 12 });
  });

  it('preserves tab deletion when local workspace has newer updatedAt timestamp', () => {
    const tab1 = { id: 't1', title: 'Google', url: 'https://google.com', hostname: 'google.com', savedAt: '2026-08-01T10:00:00Z' };
    const tab2 = { id: 't2', title: 'GitHub', url: 'https://github.com', hostname: 'github.com', savedAt: '2026-08-01T10:00:00Z' };

    const localWsNewer: Workspace = {
      id: 'ws_del',
      name: 'Work',
      color: 'sky',
      tabs: [tab1], // User deleted tab2 locally
      live: { status: 'connected', windowId: 5 },
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-02T16:00:00Z', // Local is newer
    };

    const cloudWsOlder: Workspace = {
      id: 'ws_del',
      name: 'Work',
      color: 'sky',
      tabs: [tab1, tab2], // Cloud still has tab2 from earlier
      live: { status: 'disconnected' },
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-01T10:00:00Z',
    };

    const localStore: WorkspaceStore = { schemaVersion: 2, workspaces: [localWsNewer], windowToWorkspace: { '5': 'ws_del' } };
    const cloudStore: WorkspaceStore = { schemaVersion: 2, workspaces: [cloudWsOlder], windowToWorkspace: {} };

    const merged = mergeWorkspaceStores(localStore, cloudStore);
    expect(merged.workspaces[0]!.tabs).toHaveLength(1);
    expect(merged.workspaces[0]!.tabs[0]!.url).toBe('https://google.com');
  });

  it('correctly handles duplicate tab URLs in mergeSavedTabs', () => {
    const tab1 = { id: 't1', title: 'Google 1', url: 'https://google.com', hostname: 'google.com', savedAt: '2026-08-01T10:00:00Z' };
    const tab2 = { id: 't2', title: 'Google 2', url: 'https://google.com', hostname: 'google.com', savedAt: '2026-08-01T10:00:00Z' };
    const tab3 = { id: 't3', title: 'Google 3', url: 'https://google.com', hostname: 'google.com', savedAt: '2026-08-01T10:00:00Z' };

    // Local has 2 Google tabs
    const localTabs = [tab1, tab2];
    // Cloud has 3 Google tabs
    const cloudTabs = [tab1, tab2, tab3];

    const merged = mergeSavedTabs(localTabs, cloudTabs);
    // Should contain 3 Google tabs
    expect(merged).toHaveLength(3);
  });
});
