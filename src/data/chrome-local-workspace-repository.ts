import { EMPTY_STORE, type Workspace, type WorkspaceStore } from '@/src/domain/workspace';
import type { WorkspaceRepository } from './workspace-repository';

const STORAGE_KEY = 'tab-atlas.workspace-store';

interface LegacyWorkspaceStoreV1 {
  schemaVersion: 1;
  workspaces: Array<Omit<Workspace, 'live'>>;
}

function isStoreV2(value: unknown): value is WorkspaceStore {
  const store = value as WorkspaceStore | undefined;
  return Boolean(store && typeof store === 'object' && store.schemaVersion === 2 && Array.isArray(store.workspaces));
}

function isStoreV1(value: unknown): value is LegacyWorkspaceStoreV1 {
  const store = value as LegacyWorkspaceStoreV1 | undefined;
  return Boolean(store && typeof store === 'object' && store.schemaVersion === 1 && Array.isArray(store.workspaces));
}

/**
 * Upgrades persisted data to the current schema. v1 snapshots keep every saved
 * tab but start disconnected: Chrome window ids never survive a browser restart,
 * so a window link has to be re-established the next time a workspace opens.
 */
export function migrateWorkspaceStore(value: unknown): WorkspaceStore {
  if (isStoreV2(value)) return { ...value, windowToWorkspace: value.windowToWorkspace ?? {} };

  if (isStoreV1(value)) {
    return {
      schemaVersion: 2,
      windowToWorkspace: {},
      workspaces: value.workspaces.map((workspace) => ({ ...workspace, live: { status: 'disconnected' } })),
    };
  }

  return EMPTY_STORE;
}

export class ChromeLocalWorkspaceRepository implements WorkspaceRepository {
  /** Serialises writes inside this service worker instance. */
  private queue: Promise<unknown> = Promise.resolve();

  async read(): Promise<WorkspaceStore> {
    const result = await browser.storage.local.get(STORAGE_KEY);
    return migrateWorkspaceStore(result[STORAGE_KEY]);
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
    await this.update((store) => {
      const workspaces = [...store.workspaces];
      const index = workspaces.findIndex((item) => item.id === workspace.id);

      if (index === -1) workspaces.push(workspace);
      else workspaces[index] = workspace;

      return { store: { ...store, workspaces }, result: undefined };
    });
  }

  async remove(id: string): Promise<void> {
    await this.update((store) => {
      const windowToWorkspace = Object.fromEntries(
        Object.entries(store.windowToWorkspace).filter(([, workspaceId]) => workspaceId !== id),
      );

      return {
        store: { ...store, windowToWorkspace, workspaces: store.workspaces.filter((item) => item.id !== id) },
        result: undefined,
      };
    });
  }

  async replace(store: WorkspaceStore): Promise<void> {
    await browser.storage.local.set({ [STORAGE_KEY]: store });
  }

  async update<T>(mutator: (store: WorkspaceStore) => { store: WorkspaceStore; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      const { store, result } = mutator(await this.read());
      await this.replace(store);
      return result;
    });

    this.queue = run.catch(() => undefined);
    return run;
  }
}
