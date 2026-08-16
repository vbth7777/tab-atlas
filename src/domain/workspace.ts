export type WorkspaceColor =
  | 'indigo'
  | 'sky'
  | 'teal'
  | 'emerald'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'violet';

export const workspaceColors: Record<WorkspaceColor, { label: string; value: string }> = {
  indigo: { label: 'Indigo', value: '#818cf8' },
  sky: { label: 'Sky', value: '#38bdf8' },
  teal: { label: 'Teal', value: '#2dd4bf' },
  emerald: { label: 'Emerald', value: '#34d399' },
  amber: { label: 'Amber', value: '#fbbf24' },
  orange: { label: 'Orange', value: '#fb923c' },
  rose: { label: 'Rose', value: '#fb7185' },
  violet: { label: 'Violet', value: '#a78bfa' },
};

export interface SavedTab {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
  hostname: string;
  savedAt: string;
}

/** `windowId` is only meaningful inside the current browser session. */
export interface WorkspaceLiveState {
  status: 'connected' | 'disconnected';
  windowId?: number;
  isIncognito?: boolean;
  lastSyncedAt?: string;
}

export interface Workspace {
  id: string;
  name: string;
  color: WorkspaceColor;
  tabs: SavedTab[];
  live: WorkspaceLiveState;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStore {
  schemaVersion: 2;
  workspaces: Workspace[];
  /** Maps a Chrome window id to the workspace that owns it. */
  windowToWorkspace: Record<string, string>;
}

export interface TabSnapshot {
  id: number;
  title?: string;
  url?: string;
  pendingUrl?: string;
  favIconUrl?: string;
  status?: string;
}

export const EMPTY_STORE: WorkspaceStore = { schemaVersion: 2, workspaces: [], windowToWorkspace: {} };

export function isConnected(workspace: Workspace): boolean {
  return workspace.live.status === 'connected' && workspace.live.windowId !== undefined;
}
