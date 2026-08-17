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
 * Upgrades persisted data to the current schema. Supports v2, v1, raw arrays,
 * un-versioned objects, and nested storage wrappers so legacy workspace data is
 * NEVER accidentally wiped.
 */
export function migrateWorkspaceStore(value: unknown): WorkspaceStore {
  if (!value || typeof value !== 'object') {
    return EMPTY_STORE;
  }

  // Unwrap if nested under storage key
  if ('tab-atlas.workspace-store' in value && typeof (value as any)['tab-atlas.workspace-store'] === 'object') {
    value = (value as any)['tab-atlas.workspace-store'];
  }

  if (isStoreV2(value)) {
    return {
      schemaVersion: 2,
      windowToWorkspace: value.windowToWorkspace ?? {},
      workspaces: value.workspaces.map((ws) => ({
        ...ws,
        live: ws.live || { status: 'disconnected' },
        tabs: Array.isArray(ws.tabs) ? ws.tabs : [],
        createdAt: ws.createdAt || new Date().toISOString(),
        updatedAt: ws.updatedAt || ws.createdAt || new Date().toISOString(),
      })),
    };
  }

  if (isStoreV1(value)) {
    return {
      schemaVersion: 2,
      windowToWorkspace: {},
      workspaces: value.workspaces.map((workspace) => ({
        ...workspace,
        live: { status: 'disconnected' },
        tabs: Array.isArray(workspace.tabs) ? workspace.tabs : [],
        createdAt: workspace.createdAt || new Date().toISOString(),
        updatedAt: workspace.updatedAt || workspace.createdAt || new Date().toISOString(),
      })),
    };
  }

  // Case 3: Raw Array of workspace objects [{ id, name, tabs }]
  if (Array.isArray(value)) {
    const validWorkspaces = value.filter(
      (item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string',
    );
    if (validWorkspaces.length > 0) {
      return {
        schemaVersion: 2,
        windowToWorkspace: {},
        workspaces: validWorkspaces.map((ws: any) => ({
          id: ws.id,
          name: ws.name,
          color: ws.color || 'indigo',
          createdAt: ws.createdAt || new Date().toISOString(),
          updatedAt: ws.updatedAt || ws.createdAt || new Date().toISOString(),
          tabs: Array.isArray(ws.tabs) ? ws.tabs : [],
          live: ws.live || { status: 'disconnected' },
        })),
      };
    }
  }

  // Case 4: Object containing `workspaces` array without schemaVersion
  if (value && typeof value === 'object' && 'workspaces' in value && Array.isArray((value as any).workspaces)) {
    const rawList = (value as any).workspaces;
    return {
      schemaVersion: 2,
      windowToWorkspace: (value as any).windowToWorkspace || {},
      workspaces: rawList.map((ws: any) => ({
        id: ws.id || String(Date.now() + Math.random()),
        name: ws.name || 'Untitled Workspace',
        color: ws.color || 'indigo',
        createdAt: ws.createdAt || new Date().toISOString(),
        updatedAt: ws.updatedAt || ws.createdAt || new Date().toISOString(),
        tabs: Array.isArray(ws.tabs) ? ws.tabs : [],
        live: ws.live || { status: 'disconnected' },
      })),
    };
  }

  return EMPTY_STORE;
}

export class ChromeLocalWorkspaceRepository implements WorkspaceRepository {
  /** Serialises writes inside this service worker instance. */
  private queue: Promise<unknown> = Promise.resolve();

  async read(): Promise<WorkspaceStore> {
    const result = await browser.storage.local.get(null);
    if (result && result[STORAGE_KEY]) {
      const migrated = migrateWorkspaceStore(result[STORAGE_KEY]);
      if (migrated.workspaces.length > 0) return migrated;
    }

    // Fallback: search all other keys in local storage for legacy workspace data
    if (result) {
      for (const [key, val] of Object.entries(result)) {
        if (key === STORAGE_KEY) continue;
        const migrated = migrateWorkspaceStore(val);
        if (migrated.workspaces.length > 0) {
          await browser.storage.local.set({ [STORAGE_KEY]: migrated });
          return migrated;
        }
      }
    }

    return EMPTY_STORE;
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
