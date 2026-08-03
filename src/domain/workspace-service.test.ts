import { describe, expect, it } from 'vitest';
import {
  bindWindowToWorkspace,
  createLiveWorkspace,
  disconnectWindow,
  filterWorkspaces,
  reconcileOpenWindows,
  syncWorkspaceFromWindow,
  updateWorkspaceMetadata,
} from '@/src/domain/workspace-service';
import { EMPTY_STORE, type WorkspaceStore } from '@/src/domain/workspace';
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
});
