import type { Workspace, WorkspaceStore } from '@/src/domain/workspace';

export interface WorkspaceRepository {
  list(): Promise<Workspace[]>;
  get(id: string): Promise<Workspace | null>;
  save(workspace: Workspace): Promise<void>;
  remove(id: string): Promise<void>;
  read(): Promise<WorkspaceStore>;
  replace(store: WorkspaceStore): Promise<void>;
  /**
   * Applies a mutation to the whole store as a single read-modify-write step so
   * bursts of Chrome tab events cannot overwrite each other.
   */
  update<T>(mutator: (store: WorkspaceStore) => { store: WorkspaceStore; result: T }): Promise<T>;
}
