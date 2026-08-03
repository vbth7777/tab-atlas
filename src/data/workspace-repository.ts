import type { Workspace, WorkspaceStore } from '@/src/domain/workspace';

export interface WorkspaceRepository {
  list(): Promise<Workspace[]>;
  get(id: string): Promise<Workspace | null>;
  save(workspace: Workspace): Promise<void>;
  remove(id: string): Promise<void>;
  replace(store: WorkspaceStore): Promise<void>;
}
