import { describe, expect, it } from 'vitest';
import { filterWorkspaces, saveWorkspaceFromTabs, updateWorkspaceMetadata } from '@/src/domain/workspace-service';
import type { Workspace, WorkspaceStore } from '@/src/domain/workspace';
import type { WorkspaceRepository } from '@/src/data/workspace-repository';

class MemoryRepository implements WorkspaceRepository {
  private store: WorkspaceStore = { schemaVersion: 1, workspaces: [] };
  async list() { return [...this.store.workspaces]; }
  async get(id: string) { return this.store.workspaces.find((workspace) => workspace.id === id) ?? null; }
  async save(workspace: Workspace) { this.store.workspaces = [...this.store.workspaces.filter((item) => item.id !== workspace.id), workspace]; }
  async remove(id: string) { this.store.workspaces = this.store.workspaces.filter((workspace) => workspace.id !== id); }
  async replace(store: WorkspaceStore) { this.store = store; }
}

describe('workspace service', () => {
  it('captures only web tabs with searchable tab metadata', async () => {
    const repository = new MemoryRepository();
    const workspace = await saveWorkspaceFromTabs(repository, { name: 'Research', color: 'teal', tabs: [
      { id: 1, title: 'Web APIs | MDN', url: 'https://developer.mozilla.org/en-US/docs/Web/API', favIconUrl: 'https://developer.mozilla.org/favicon.ico' },
      { id: 2, title: 'Extensions', url: 'chrome://extensions' },
    ] });

    expect(workspace.tabs).toHaveLength(1);
    expect(workspace.tabs.at(0)).toMatchObject({ title: 'Web APIs | MDN', hostname: 'developer.mozilla.org' });
    expect((await repository.list()).at(0)?.name).toBe('Research');
  });

  it('updates metadata and finds a workspace through its saved URL', async () => {
    const repository = new MemoryRepository();
    const workspace = await saveWorkspaceFromTabs(repository, { name: 'Reading', color: 'indigo', tabs: [{ id: 1, title: 'Release notes', url: 'https://example.com/releases' }] });
    const updated = await updateWorkspaceMetadata(repository, { id: workspace.id, name: 'Product reading', color: 'rose' });

    expect(updated).toMatchObject({ name: 'Product reading', color: 'rose' });
    expect(filterWorkspaces([updated], 'example.com')).toEqual([updated]);
  });
});
