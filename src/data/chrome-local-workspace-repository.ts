import { EMPTY_STORE, type Workspace, type WorkspaceStore } from '@/src/domain/workspace';
import type { WorkspaceRepository } from './workspace-repository';

const STORAGE_KEY = 'tab-atlas.workspace-store';

function isWorkspaceStore(value: unknown): value is WorkspaceStore {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as WorkspaceStore).schemaVersion === 1 &&
      Array.isArray((value as WorkspaceStore).workspaces),
  );
}

export function migrateWorkspaceStore(value: unknown): WorkspaceStore {
  if (isWorkspaceStore(value)) return value;
  return EMPTY_STORE;
}

export class ChromeLocalWorkspaceRepository implements WorkspaceRepository {
  private async read(): Promise<WorkspaceStore> {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const store = migrateWorkspaceStore(result[STORAGE_KEY]);

    if (result[STORAGE_KEY] !== store) {
      await this.replace(store);
    }

    return store;
  }

  async list(): Promise<Workspace[]> {
    const store = await this.read();
    return [...store.workspaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Workspace | null> {
    const store = await this.read();
    return store.workspaces.find((workspace) => workspace.id === id) ?? null;
  }

  async save(workspace: Workspace): Promise<void> {
    const store = await this.read();
    const index = store.workspaces.findIndex((item) => item.id === workspace.id);
    const workspaces = [...store.workspaces];

    if (index === -1) workspaces.push(workspace);
    else workspaces[index] = workspace;

    await this.replace({ ...store, workspaces });
  }

  async remove(id: string): Promise<void> {
    const store = await this.read();
    await this.replace({ ...store, workspaces: store.workspaces.filter((item) => item.id !== id) });
  }

  async replace(store: WorkspaceStore): Promise<void> {
    await browser.storage.local.set({ [STORAGE_KEY]: store });
  }
}
