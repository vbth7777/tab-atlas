import { describe, expect, it } from 'vitest';
import {
  bindWindowToWorkspace,
  clearWorkspaceHistory,
  createLiveWorkspace,
  deleteWorkspace,
  disconnectWindow,
  filterWorkspaces,
  mergeSavedTabs,
  mergeWorkspaceStores,
  reconcileOpenWindows,
  recordWorkspaceHistoryBatch,
  syncWorkspaceFromWindow,
  trimWorkspaceHistory,
  updateWorkspaceMetadata,
  getDuplicateTabGroups,
  deduplicateSavedTabs,
  deduplicateWorkspace,
  addTabsToWorkspace,
  buildWorkspaceTree,
  splitWorkspace,
  mergeChildrenToParent,
  createChildWorkspace,
  moveTabsBetweenWorkspaces,
  getTreeDuplicateTabGroups,
  deduplicateWorkspaceTree,
  resolveMassDrop,
} from '@/src/domain/workspace-service';
import { EMPTY_STORE, type SavedTab, type Workspace, type WorkspaceStore } from '@/src/domain/workspace';
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

  it('prevents deleted workspaces from being resurrected by older cloudStore via tombstones', () => {
    const wsActive: Workspace = {
      id: 'ws_active',
      name: 'Active Project',
      color: 'teal',
      tabs: [],
      live: { status: 'disconnected' },
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-01T10:00:00Z',
    };

    const wsDeletedOnLocal: Workspace = {
      id: 'ws_deleted',
      name: 'Old Project (Deleted Locally)',
      color: 'rose',
      tabs: [{ id: 't1', title: 'Old Tab', url: 'https://old.com', hostname: 'old.com', savedAt: '2026-08-01T10:00:00Z' }],
      live: { status: 'disconnected' },
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-01T11:00:00Z', // Updated before deletion
    };

    // Local store recorded deletion tombstone at 12:00:00
    const localStore: WorkspaceStore = {
      schemaVersion: 2,
      workspaces: [wsActive],
      windowToWorkspace: {},
      deletedWorkspaces: {
        ws_deleted: '2026-08-01T12:00:00Z',
      },
    };

    // Cloud store still has ws_deleted from earlier sync
    const cloudStore: WorkspaceStore = {
      schemaVersion: 2,
      workspaces: [wsActive, wsDeletedOnLocal],
      windowToWorkspace: {},
      deletedWorkspaces: {},
    };

    const testNowMs = new Date('2026-08-01T16:00:00Z').getTime();
    const merged = mergeWorkspaceStores(localStore, cloudStore, testNowMs);
    // ws_deleted must NOT be resurrected!
    expect(merged.workspaces).toHaveLength(1);
    expect(merged.workspaces[0]!.id).toBe('ws_active');
    expect(merged.deletedWorkspaces?.ws_deleted).toBe('2026-08-01T12:00:00Z');
  });

  it('propagates deletedWorkspaces from cloudStore to localStore and deletes local workspace', () => {
    const wsToRemotelyDelete: Workspace = {
      id: 'ws_remote_del',
      name: 'Deleted on Another Device',
      color: 'amber',
      tabs: [],
      live: { status: 'disconnected' },
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-01T10:00:00Z',
    };

    const localStore: WorkspaceStore = {
      schemaVersion: 2,
      workspaces: [wsToRemotelyDelete],
      windowToWorkspace: {},
      deletedWorkspaces: {},
    };

    const cloudStore: WorkspaceStore = {
      schemaVersion: 2,
      workspaces: [],
      windowToWorkspace: {},
      deletedWorkspaces: {
        ws_remote_del: '2026-08-01T15:00:00Z',
      },
    };

    const testNowMs = new Date('2026-08-01T16:00:00Z').getTime();
    const merged = mergeWorkspaceStores(localStore, cloudStore, testNowMs);
    // Must be deleted on local device as well
    expect(merged.workspaces).toHaveLength(0);
    expect(merged.deletedWorkspaces?.ws_remote_del).toBe('2026-08-01T15:00:00Z');
  });

  it('correctly preserves parentId during cloud and local merges', () => {
    const parentWs: Workspace = {
      id: 'ws_parent',
      name: 'Parent Workspace',
      color: 'indigo',
      tabs: [],
      live: { status: 'disconnected' },
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-01T10:00:00Z',
      parentId: null,
    };

    const childWsLocal: Workspace = {
      id: 'ws_child',
      name: 'Child Workspace (Local)',
      color: 'teal',
      tabs: [],
      live: { status: 'disconnected' },
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-01T10:00:00Z',
      parentId: 'ws_parent',
    };

    const childWsCloudNewer: Workspace = {
      id: 'ws_child',
      name: 'Child Workspace (Cloud Newer)',
      color: 'teal',
      tabs: [],
      live: { status: 'disconnected' },
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-02T10:00:00Z',
      parentId: 'ws_parent',
    };

    const localStore: WorkspaceStore = {
      schemaVersion: 2,
      workspaces: [parentWs, childWsLocal],
      windowToWorkspace: {},
    };

    const cloudStore: WorkspaceStore = {
      schemaVersion: 2,
      workspaces: [parentWs, childWsCloudNewer],
      windowToWorkspace: {},
    };

    const merged = mergeWorkspaceStores(localStore, cloudStore);
    const mergedChild = merged.workspaces.find((w) => w.id === 'ws_child');
    expect(mergedChild?.name).toBe('Child Workspace (Cloud Newer)');
    expect(mergedChild?.parentId).toBe('ws_parent');
  });
});

describe('workspace tab history', () => {
  it('records and trims history batches for a workspace', async () => {
    const repository = new MemoryRepository();
    const ws = await createLiveWorkspace(repository, {
      name: 'Dev',
      color: 'teal',
      windowId: 1,
      tabs: [tab(1, 'https://github.com')],
    });

    const updated = await recordWorkspaceHistoryBatch(repository, ws.id, [
      {
        url: 'https://developer.mozilla.org',
        title: 'MDN Web Docs',
        hostname: 'developer.mozilla.org',
        timestamp: '2026-08-19T10:00:00Z',
        eventType: 'visited',
      },
      {
        url: 'https://vitejs.dev',
        title: 'Vite',
        hostname: 'vitejs.dev',
        timestamp: '2026-08-19T10:05:00Z',
        eventType: 'closed',
        batchId: 'batch_123',
      },
    ]);

    expect(updated.history).toHaveLength(2);
    expect(updated.history?.[0]?.title).toBe('MDN Web Docs');
    expect(updated.history?.[1]?.eventType).toBe('closed');
    expect(updated.history?.[1]?.batchId).toBe('batch_123');

    // Test trimming
    const manyEntries = Array.from({ length: 250 }, (_, i) => ({
      id: `h_${i}`,
      url: `https://example.com/${i}`,
      title: `Page ${i}`,
      hostname: 'example.com',
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      eventType: 'visited' as const,
    }));
    const trimmed = trimWorkspaceHistory(manyEntries, 200);
    expect(trimmed).toHaveLength(200);
  });

  it('clears history for a workspace', async () => {
    const repository = new MemoryRepository();
    const ws = await createLiveWorkspace(repository, {
      name: 'Dev',
      color: 'teal',
      windowId: 1,
      tabs: [tab(1, 'https://github.com')],
    });

    await recordWorkspaceHistoryBatch(repository, ws.id, [
      {
        url: 'https://example.com',
        title: 'Example',
        hostname: 'example.com',
        timestamp: '2026-08-19T10:00:00Z',
        eventType: 'closed',
      },
    ]);

    const cleared = await clearWorkspaceHistory(repository, ws.id);
    expect(cleared.history).toEqual([]);
    expect((await repository.get(ws.id))?.history).toEqual([]);
  });
});

describe('duplicate tab detection and deduplication', () => {
  const createTestTabs = (): SavedTab[] => [
    { id: 't1', title: 'YouTube - Video 1', url: 'https://youtube.com/watch?v=1', hostname: 'youtube.com', savedAt: '2026-08-22T00:00:00Z' },
    { id: 't2', title: 'GitHub - PR', url: 'https://github.com/repo/pull/1', hostname: 'github.com', savedAt: '2026-08-22T00:01:00Z' },
    { id: 't3', title: 'YouTube - Video 1 Duplicate', url: 'https://youtube.com/watch?v=1', hostname: 'youtube.com', savedAt: '2026-08-22T00:02:00Z' },
    { id: 't4', title: 'Google Search', url: 'https://google.com', hostname: 'google.com', savedAt: '2026-08-22T00:03:00Z' },
    { id: 't5', title: 'YouTube - Video 1 Third', url: 'https://youtube.com/watch?v=1', hostname: 'youtube.com', savedAt: '2026-08-22T00:04:00Z' },
    { id: 't6', title: 'GitHub - PR Duplicate', url: 'https://github.com/repo/pull/1', hostname: 'github.com', savedAt: '2026-08-22T00:05:00Z' },
  ];

  it('detects duplicate groups and computes correct counts', () => {
    const tabs = createTestTabs();
    const groups = getDuplicateTabGroups(tabs);

    expect(groups).toHaveLength(2);
    // YouTube has 3 tabs (2 redundant), sorted first
    expect(groups[0]?.url).toBe('https://youtube.com/watch?v=1');
    expect(groups[0]?.count).toBe(3);
    expect(groups[0]?.redundantCount).toBe(2);
    expect(groups[0]?.tabIds).toEqual(['t1', 't3', 't5']);

    // GitHub has 2 tabs (1 redundant)
    expect(groups[1]?.url).toBe('https://github.com/repo/pull/1');
    expect(groups[1]?.count).toBe(2);
    expect(groups[1]?.redundantCount).toBe(1);
    expect(groups[1]?.tabIds).toEqual(['t2', 't6']);
  });

  it('returns empty array when there are no duplicate tabs', () => {
    const tabs: SavedTab[] = [
      { id: 't1', title: 'A', url: 'https://a.com', hostname: 'a.com', savedAt: '2026-08-22T00:00:00Z' },
      { id: 't2', title: 'B', url: 'https://b.com', hostname: 'b.com', savedAt: '2026-08-22T00:00:00Z' },
    ];
    expect(getDuplicateTabGroups(tabs)).toEqual([]);
  });

  it('deduplicates all duplicate tabs keeping first occurrence', () => {
    const tabs = createTestTabs();
    const { remainingTabs, removedTabs, removedCount } = deduplicateSavedTabs(tabs);

    expect(removedCount).toBe(3);
    expect(removedTabs.map((t) => t.id)).toEqual(['t3', 't5', 't6']);
    expect(remainingTabs.map((t) => t.id)).toEqual(['t1', 't2', 't4']);
    expect(remainingTabs.map((t) => t.url)).toEqual([
      'https://youtube.com/watch?v=1',
      'https://github.com/repo/pull/1',
      'https://google.com',
    ]);
  });

  it('deduplicates only specified targetUrls', () => {
    const tabs = createTestTabs();
    // Only deduplicate YouTube, leave GitHub duplicates intact
    const { remainingTabs, removedTabs, removedCount } = deduplicateSavedTabs(tabs, ['https://youtube.com/watch?v=1']);

    expect(removedCount).toBe(2);
    expect(removedTabs.map((t) => t.id)).toEqual(['t3', 't5']);
    expect(remainingTabs.map((t) => t.id)).toEqual(['t1', 't2', 't4', 't6']);
  });

  it('deduplicates workspace in repository', async () => {
    const repository = new MemoryRepository();
    const workspace: Workspace = {
      id: 'ws_dup',
      name: 'Dup Workspace',
      color: 'indigo',
      tabs: createTestTabs(),
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };
    await repository.save(workspace);

    const result = await deduplicateWorkspace(repository, 'ws_dup', ['https://github.com/repo/pull/1']);
    expect(result.removedCount).toBe(1);
    expect(result.workspace.tabs).toHaveLength(5);

    const saved = await repository.get('ws_dup');
    expect(saved?.tabs).toHaveLength(5);
    expect(saved?.tabs.filter((t) => t.url === 'https://github.com/repo/pull/1')).toHaveLength(1);
    // YouTube still has 3 tabs because it wasn't in targetUrls
    expect(saved?.tabs.filter((t) => t.url === 'https://youtube.com/watch?v=1')).toHaveLength(3);
  });
});

describe('adding tabs to workspace', () => {
  it('adds valid web tabs to an existing workspace', async () => {
    const repository = new MemoryRepository();
    const ws: Workspace = {
      id: 'ws_target',
      name: 'Project Target',
      color: 'teal',
      tabs: [{ id: 't1', title: 'Home', url: 'https://home.com', hostname: 'home.com', savedAt: '2026-08-22T00:00:00Z' }],
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };
    await repository.save(ws);

    const res = await addTabsToWorkspace(repository, 'ws_target', [
      { url: 'https://news.ycombinator.com', title: 'Hacker News' },
      { url: 'chrome://extensions', title: 'Extensions' }, // Non-web tab, should be ignored
      { url: 'https://github.com/trending', title: 'Trending' },
    ]);

    expect(res.addedCount).toBe(2);
    expect(res.workspace.tabs).toHaveLength(3);
    expect(res.workspace.tabs.map((t) => t.url)).toEqual([
      'https://home.com',
      'https://news.ycombinator.com',
      'https://github.com/trending',
    ]);

    const saved = await repository.get('ws_target');
    expect(saved?.tabs).toHaveLength(3);
  });

  it('throws error if workspace does not exist', async () => {
    const repository = new MemoryRepository();
    await expect(
      addTabsToWorkspace(repository, 'non_existent', [{ url: 'https://example.com' }])
    ).rejects.toThrow('Workspace not found.');
  });
});

describe('workspace tree hierarchy and splitting', () => {
  it('builds a tree structure with parent and children', () => {
    const workspaces: Workspace[] = [
      {
        id: 'ws_parent1',
        name: 'Parent 1',
        color: 'indigo',
        tabs: [
          { id: 't1', title: 'P1', url: 'https://p1.com', hostname: 'p1.com', savedAt: '2026-08-22' },
        ],
        live: { status: 'disconnected' },
        createdAt: '2026-08-22T01:00:00Z',
        updatedAt: '2026-08-22T01:00:00Z',
      },
      {
        id: 'ws_child1',
        parentId: 'ws_parent1',
        name: 'Child 1',
        color: 'sky',
        tabs: [
          { id: 't2', title: 'C1', url: 'https://c1.com', hostname: 'c1.com', savedAt: '2026-08-22' },
          { id: 't3', title: 'C2', url: 'https://c2.com', hostname: 'c2.com', savedAt: '2026-08-22' },
        ],
        live: { status: 'disconnected' },
        createdAt: '2026-08-22T02:00:00Z',
        updatedAt: '2026-08-22T02:00:00Z',
      },
      {
        id: 'ws_parent2',
        name: 'Parent 2',
        color: 'teal',
        tabs: [],
        live: { status: 'disconnected' },
        createdAt: '2026-08-22T03:00:00Z',
        updatedAt: '2026-08-22T03:00:00Z',
      },
    ];

    const tree = buildWorkspaceTree(workspaces);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.workspace.id).toBe('ws_parent1');
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.id).toBe('ws_child1');
    expect(tree[0]!.totalTabsCount).toBe(3);
    expect(tree[1]!.workspace.id).toBe('ws_parent2');
    expect(tree[1]!.totalTabsCount).toBe(0);
  });

  it('splits a workspace by tab count', async () => {
    const repository = new MemoryRepository();
    const testTabs: SavedTab[] = Array.from({ length: 55 }, (_, i) => ({
      id: `t_${i}`,
      title: `Tab ${i}`,
      url: `https://example.com/tab/${i}`,
      hostname: 'example.com',
      savedAt: '2026-08-22',
    }));

    const parent: Workspace = {
      id: 'ws_big',
      name: 'Big Workspace',
      color: 'rose',
      tabs: testTabs,
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };
    await repository.save(parent);

    const result = await splitWorkspace(repository, {
      parentWorkspaceId: 'ws_big',
      splitMode: 'by_tab_count',
      value: 20,
      childNamePrefix: 'Big Part',
    });

    expect(result.children).toHaveLength(3); // 20 + 20 + 15
    expect(result.children[0]!.tabs).toHaveLength(20);
    expect(result.children[1]!.tabs).toHaveLength(20);
    expect(result.children[2]!.tabs).toHaveLength(15);
    expect(result.children[0]!.name).toBe('Big Part 1');
    expect(result.children[0]!.parentId).toBe('ws_big');
    expect(result.parent.tabs).toHaveLength(0); // Moved tabs to children

    const all = await repository.list();
    expect(all).toHaveLength(4); // 1 parent + 3 children
  });

  it('splits a workspace by number of children', async () => {
    const repository = new MemoryRepository();
    const testTabs: SavedTab[] = Array.from({ length: 10 }, (_, i) => ({
      id: `t_${i}`,
      title: `Tab ${i}`,
      url: `https://example.com/tab/${i}`,
      hostname: 'example.com',
      savedAt: '2026-08-22',
    }));

    const parent: Workspace = {
      id: 'ws_split_child_count',
      name: 'Split By Count',
      color: 'teal',
      tabs: testTabs,
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };
    await repository.save(parent);

    const result = await splitWorkspace(repository, {
      parentWorkspaceId: 'ws_split_child_count',
      splitMode: 'by_child_count',
      value: 3,
    });

    expect(result.children).toHaveLength(3);
    const sum = result.children.reduce((acc, c) => acc + c.tabs.length, 0);
    expect(sum).toBe(10);
  });

  it('merges children back to parent workspace', async () => {
    const repository = new MemoryRepository();
    const parent: Workspace = {
      id: 'ws_merge_p',
      name: 'Parent Merge',
      color: 'indigo',
      tabs: [{ id: 'p1', title: 'P1', url: 'https://p.com', hostname: 'p.com', savedAt: '2026-08-22' }],
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };
    const child1: Workspace = {
      id: 'ws_merge_c1',
      parentId: 'ws_merge_p',
      name: 'Child 1',
      color: 'sky',
      tabs: [{ id: 'c1', title: 'C1', url: 'https://c1.com', hostname: 'c1.com', savedAt: '2026-08-22' }],
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };
    const child2: Workspace = {
      id: 'ws_merge_c2',
      parentId: 'ws_merge_p',
      name: 'Child 2',
      color: 'teal',
      tabs: [{ id: 'c2', title: 'C2', url: 'https://c2.com', hostname: 'c2.com', savedAt: '2026-08-22' }],
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };

    await repository.save(parent);
    await repository.save(child1);
    await repository.save(child2);

    const res = await mergeChildrenToParent(repository, 'ws_merge_p', true);
    expect(res.mergedTabsCount).toBe(2);
    expect(res.parent.tabs).toHaveLength(3);

    const remaining = await repository.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('ws_merge_p');
    expect(remaining[0]!.tabs).toHaveLength(3);
  });

  it('moves tabs between workspaces (drag & drop / multi-select)', async () => {
    const repository = new MemoryRepository();
    const ws1: Workspace = {
      id: 'ws_source',
      name: 'Source WS',
      color: 'indigo',
      tabs: [
        { id: 't1', title: 'Tab 1', url: 'https://1.com', hostname: '1.com', savedAt: '2026-08-22' },
        { id: 't2', title: 'Tab 2', url: 'https://2.com', hostname: '2.com', savedAt: '2026-08-22' },
        { id: 't3', title: 'Tab 3', url: 'https://3.com', hostname: '3.com', savedAt: '2026-08-22' },
      ],
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };

    const ws2: Workspace = {
      id: 'ws_target',
      name: 'Target WS (Child of other parent)',
      parentId: 'ws_other_parent',
      color: 'emerald',
      tabs: [
        { id: 't4', title: 'Tab 4', url: 'https://4.com', hostname: '4.com', savedAt: '2026-08-22' },
      ],
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };

    await repository.save(ws1);
    await repository.save(ws2);

    const result = await moveTabsBetweenWorkspaces(repository, 'ws_source', 'ws_target', ['t1', 't3']);
    expect(result.movedCount).toBe(2);
    expect(result.source.tabs.map((t) => t.id)).toEqual(['t2']);
    expect(result.target.tabs.map((t) => t.id)).toEqual(['t4', 't1', 't3']);

    const savedSource = await repository.get('ws_source');
    const savedTarget = await repository.get('ws_target');
    expect(savedSource?.tabs).toHaveLength(1);
    expect(savedTarget?.tabs).toHaveLength(3);
  });

  it('scans and deduplicates across tree hierarchy', async () => {
    const repository = new MemoryRepository();
    const parent: Workspace = {
      id: 'ws_tree_root',
      name: 'Tree Root',
      color: 'indigo',
      tabs: [
        { id: 't1', title: 'GitHub', url: 'https://github.com/a', hostname: 'github.com', savedAt: '2026-08-22' },
        { id: 't2', title: 'Google', url: 'https://google.com', hostname: 'google.com', savedAt: '2026-08-22' },
      ],
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };
    const child1: Workspace = {
      id: 'ws_tree_c1',
      parentId: 'ws_tree_root',
      name: 'Tree Child 1',
      color: 'sky',
      tabs: [
        { id: 't3', title: 'GitHub Dup in Child 1', url: 'https://github.com/a', hostname: 'github.com', savedAt: '2026-08-22' },
        { id: 't4', title: 'Yahoo', url: 'https://yahoo.com', hostname: 'yahoo.com', savedAt: '2026-08-22' },
      ],
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };
    const child2: Workspace = {
      id: 'ws_tree_c2',
      parentId: 'ws_tree_root',
      name: 'Tree Child 2',
      color: 'teal',
      tabs: [
        { id: 't5', title: 'GitHub Dup in Child 2', url: 'https://github.com/a', hostname: 'github.com', savedAt: '2026-08-22' },
      ],
      live: { status: 'disconnected' },
      createdAt: '2026-08-22T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };

    await repository.save(parent);
    await repository.save(child1);
    await repository.save(child2);

    const treeWorkspaces = [parent, child1, child2];
    const dupGroups = getTreeDuplicateTabGroups(treeWorkspaces, 'ws_tree_root');
    expect(dupGroups).toHaveLength(1);
    expect(dupGroups[0]!.url).toBe('https://github.com/a');
    expect(dupGroups[0]!.totalCount).toBe(3);
    expect(dupGroups[0]!.redundantCount).toBe(2);
    expect(dupGroups[0]!.occurrences).toHaveLength(3);

    const dedupResult = await deduplicateWorkspaceTree(repository, 'ws_tree_root', ['https://github.com/a']);
    expect(dedupResult.totalRemovedCount).toBe(2);

    const afterParent = await repository.get('ws_tree_root');
    const afterC1 = await repository.get('ws_tree_c1');
    const afterC2 = await repository.get('ws_tree_c2');

    expect(afterParent?.tabs).toHaveLength(2); // Kept the first occurrence
    expect(afterC1?.tabs).toHaveLength(1); // Removed github.com/a, kept yahoo.com
    expect(afterC2?.tabs).toHaveLength(0); // Removed github.com/a
  });

  it('creates custom child workspace with empty or initial tabs', async () => {
    const repository = new MemoryRepository();
    const parent: Workspace = {
      id: 'ws_custom_parent',
      name: 'Main Project',
      color: 'indigo',
      tabs: [
        { id: 't1', title: 'React Docs', url: 'https://react.dev', hostname: 'react.dev', savedAt: '2026-08-26' },
        { id: 't2', title: 'Vite Guide', url: 'https://vite.dev', hostname: 'vite.dev', savedAt: '2026-08-26' },
      ],
      live: { status: 'disconnected' },
      createdAt: '2026-08-26T00:00:00Z',
      updatedAt: '2026-08-26T00:00:00Z',
    };
    await repository.save(parent);

    // 1. Create empty child workspace
    const emptyChild = await createChildWorkspace(repository, 'ws_custom_parent', 'Empty Notes', 'sky');
    expect(emptyChild.name).toBe('Empty Notes');
    expect(emptyChild.color).toBe('sky');
    expect(emptyChild.parentId).toBe('ws_custom_parent');
    expect(emptyChild.tabs).toHaveLength(0);

    // 2. Create child workspace with initial tabs and remove from parent
    const childWithTabs = await createChildWorkspace(
      repository,
      'ws_custom_parent',
      'Docs Sub-Group',
      'teal',
      [{ url: 'https://react.dev', title: 'React Docs' }],
      true
    );
    expect(childWithTabs.tabs).toHaveLength(1);
    expect(childWithTabs.tabs[0]!.url).toBe('https://react.dev');

    const updatedParent = await repository.get('ws_custom_parent');
    expect(updatedParent?.tabs).toHaveLength(1);
    expect(updatedParent?.tabs[0]!.url).toBe('https://vite.dev');
  });

  it('deletes workspace and cascades to child workspaces with tombstones', async () => {
    const repository = new MemoryRepository();
    const parent: Workspace = {
      id: 'ws_cascade_parent',
      name: 'To Delete Parent',
      color: 'indigo',
      tabs: [],
      live: { status: 'disconnected' },
      createdAt: '2026-08-26T00:00:00Z',
      updatedAt: '2026-08-26T00:00:00Z',
    };
    const child: Workspace = {
      id: 'ws_cascade_child',
      name: 'To Delete Child',
      color: 'sky',
      parentId: 'ws_cascade_parent',
      tabs: [],
      live: { status: 'disconnected' },
      createdAt: '2026-08-26T00:00:00Z',
      updatedAt: '2026-08-26T00:00:00Z',
    };

    await repository.save(parent);
    await repository.save(child);

    const { deletedIds } = await deleteWorkspace(repository, 'ws_cascade_parent');
    expect(deletedIds).toContain('ws_cascade_parent');
    expect(deletedIds).toContain('ws_cascade_child');

    const remaining = await repository.list();
    expect(remaining).toHaveLength(0);

    const store = await repository.read();
    expect(store.deletedWorkspaces?.ws_cascade_parent).toBeDefined();
    expect(store.deletedWorkspaces?.ws_cascade_child).toBeDefined();
  });

  it('rejects splitting a child workspace', async () => {
    const repository = new MemoryRepository();
    const root: Workspace = {
      id: 'ws_root',
      name: 'Root WS',
      color: 'indigo',
      tabs: [],
      live: { status: 'disconnected' },
      createdAt: '2026-08-26T00:00:00Z',
      updatedAt: '2026-08-26T00:00:00Z',
    };
    const child: Workspace = {
      id: 'ws_child',
      name: 'Child WS',
      color: 'sky',
      parentId: 'ws_root',
      tabs: [
        { id: 't1', title: 'Tab 1', url: 'https://example.com/1', hostname: 'example.com', savedAt: '2026-08-26T00:00:00Z' },
        { id: 't2', title: 'Tab 2', url: 'https://example.com/2', hostname: 'example.com', savedAt: '2026-08-26T00:00:00Z' },
      ],
      live: { status: 'disconnected' },
      createdAt: '2026-08-26T00:00:00Z',
      updatedAt: '2026-08-26T00:00:00Z',
    };

    await repository.save(root);
    await repository.save(child);

    await expect(
      splitWorkspace(repository, {
        parentWorkspaceId: 'ws_child',
        splitMode: 'by_child_count',
        value: 2,
      })
    ).rejects.toThrow('Chỉ có thể chia đều tab từ Workspace Gốc');
  });

  describe('Mass Tab Drop Protection', () => {
    it('does not lock sync when user normally closes 1 tab', async () => {
      const repository = new MemoryRepository();
      const initialTabs = Array.from({ length: 10 }, (_, i) => ({
        id: `tab_${i}`,
        title: `Tab ${i}`,
        url: `https://example.com/page/${i}`,
        hostname: 'example.com',
        savedAt: '2026-09-09T10:00:00Z',
      }));

      const ws: Workspace = {
        id: 'ws_test',
        name: 'Comics',
        color: 'sky',
        tabs: initialTabs,
        live: { status: 'connected', windowId: 101 },
        createdAt: '2026-09-09T10:00:00Z',
        updatedAt: '2026-09-09T10:00:00Z',
      };
      await repository.save(ws);
      await repository.update((store) => ({
        store: { ...store, windowToWorkspace: { '101': 'ws_test' } },
        result: undefined,
      }));

      // Close 1 tab (remaining 9 tabs)
      const currentTabs = initialTabs.slice(0, 9).map((t, idx) => ({
        id: idx + 1,
        url: t.url,
        title: t.title,
        status: 'complete',
      }));

      const synced = await syncWorkspaceFromWindow(repository, {
        windowId: 101,
        tabs: currentTabs,
      });

      expect(synced?.tabs).toHaveLength(9);
      expect(synced?.live.syncLocked).toBeFalsy();
      expect(synced?.live.massDropWarning).toBeUndefined();
    });

    it('protects workspace tabs and locks sync when massive tabs disappear (OOM scenario)', async () => {
      const repository = new MemoryRepository();
      // 64 tabs
      const initialTabs = Array.from({ length: 64 }, (_, i) => ({
        id: `tab_${i}`,
        title: `Comic Chapter ${i}`,
        url: `https://vinahentai.lat/chapter/${i}`,
        hostname: 'vinahentai.lat',
        savedAt: '2026-09-09T10:00:00Z',
      }));

      const ws: Workspace = {
        id: 'ws_comics',
        name: 'Comics 2',
        color: 'rose',
        tabs: initialTabs,
        live: { status: 'connected', windowId: 202 },
        createdAt: '2026-09-09T10:00:00Z',
        updatedAt: '2026-09-09T10:00:00Z',
      };
      await repository.save(ws);
      await repository.update((store) => ({
        store: { ...store, windowToWorkspace: { '202': 'ws_comics' } },
        result: undefined,
      }));

      // Suddenly only 10 active tabs remain in window (54 sleeping tabs closed by OOM)
      const survivingTabs = initialTabs.slice(0, 10).map((t, idx) => ({
        id: idx + 1,
        url: t.url,
        title: t.title,
        status: 'complete',
      }));

      const synced = await syncWorkspaceFromWindow(repository, {
        windowId: 202,
        tabs: survivingTabs,
      });

      // Crucial: Workspace tabs MUST be protected (still 64 tabs)!
      expect(synced?.tabs).toHaveLength(64);
      expect(synced?.live.syncLocked).toBe(true);
      expect(synced?.live.massDropWarning).toBeDefined();
      expect(synced?.live.massDropWarning?.previousCount).toBe(64);
      expect(synced?.live.massDropWarning?.currentCount).toBe(10);
      expect(synced?.live.massDropWarning?.droppedCount).toBe(54);
      expect(synced?.live.massDropWarning?.missingTabs).toHaveLength(54);

      // Rescue session snapshot must be created in history
      const snapshotEntry = synced?.history?.find((h) => h.eventType === 'session_snapshot');
      expect(snapshotEntry).toBeDefined();
      expect(snapshotEntry?.tabsSnapshot).toHaveLength(64);

      // Resolving with 'restore_missing' unlocks and returns the 54 missing tabs
      const restoreRes = await resolveMassDrop(repository, {
        workspaceId: 'ws_comics',
        action: 'restore_missing',
      });
      expect(restoreRes.workspace.live.syncLocked).toBe(false);
      expect(restoreRes.workspace.live.massDropWarning).toBeUndefined();
      expect(restoreRes.missingTabsToRestore).toHaveLength(54);

      // Resolving with 'accept_current' updates workspace with current tabs
      // Re-trigger lock first
      await syncWorkspaceFromWindow(repository, {
        windowId: 202,
        tabs: survivingTabs,
      });
      const acceptRes = await resolveMassDrop(repository, {
        workspaceId: 'ws_comics',
        action: 'accept_current',
        currentTabs: survivingTabs,
      });
      expect(acceptRes.workspace.live.syncLocked).toBe(false);
      expect(acceptRes.workspace.tabs).toHaveLength(10);
    });

    it('preserves existing workspace tabs when a tab temporarily turns into about:blank', async () => {
      const repository = new MemoryRepository({
        schemaVersion: 2,
        workspaces: [
          {
            id: 'ws_test_blank',
            name: 'Test Blank Protection',
            color: 'blue',
            tabs: [
              { id: 't1', title: 'GitHub', url: 'https://github.com', hostname: 'github.com', savedAt: '2026-08-01T10:00:00Z' },
              { id: 't2', title: 'Google', url: 'https://google.com', hostname: 'google.com', savedAt: '2026-08-01T10:00:00Z' },
            ],
            live: { status: 'connected', windowId: 999 },
            createdAt: '2026-08-01T10:00:00Z',
            updatedAt: '2026-08-01T10:00:00Z',
          },
        ],
        windowToWorkspace: { '999': 'ws_test_blank' },
      });

      // Window snapshot where tab 2 is temporarily about:blank (e.g. during discard or crash)
      const tabsSnapshot: TabSnapshot[] = [
        { id: 1, title: 'GitHub', url: 'https://github.com', status: 'complete' },
        { id: 2, title: '', url: 'about:blank', status: 'loading' },
      ];

      const res = await syncWorkspaceFromWindow(repository, {
        windowId: 999,
        tabs: tabsSnapshot,
      });

      // Should keep both saved tabs instead of dropping tab 2
      expect(res?.tabs).toHaveLength(2);
      expect(res?.tabs.map((t) => t.url)).toEqual(['https://github.com', 'https://google.com']);
    });
  });
});



