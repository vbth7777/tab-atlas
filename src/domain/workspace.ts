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
  syncLocked?: boolean;
  massDropWarning?: {
    detectedAt: string;
    previousCount: number;
    currentCount: number;
    droppedCount: number;
    missingTabs: Array<{ url: string; title: string; faviconUrl?: string }>;
  };
}

export type TabHistoryEventType = 'opened' | 'visited' | 'closed' | 'window_closed' | 'session_snapshot';

export interface WorkspaceHistoryEntry {
  id: string;
  tabId?: number;
  url: string;
  title: string;
  faviconUrl?: string;
  hostname: string;
  timestamp: string;
  eventType: TabHistoryEventType;
  isIncognito?: boolean;
  batchId?: string;
  tabCount?: number;
  tabsSnapshot?: Array<{ title: string; url: string; faviconUrl?: string }>;
}

export interface Workspace {
  id: string;
  name: string;
  color: WorkspaceColor;
  tabs: SavedTab[];
  history?: WorkspaceHistoryEntry[];
  live: WorkspaceLiveState;
  createdAt: string;
  updatedAt: string;
  parentId?: string | null;
}

export interface WorkspaceTreeNode {
  workspace: Workspace;
  children: Workspace[];
  totalTabsCount: number;
  totalChildCount: number;
  hasLive: boolean;
}

export interface WorkspaceStore {
  schemaVersion: 2;
  workspaces: Workspace[];
  /** Maps a Chrome window id to the workspace that owns it. */
  windowToWorkspace: Record<string, string>;
  /** Tombstones for deleted workspaces to prevent resurrection during cloud sync: workspaceId -> ISO deletedAt */
  deletedWorkspaces?: Record<string, string>;
}

export interface TabSnapshot {
  id: number;
  title?: string;
  url?: string;
  pendingUrl?: string;
  favIconUrl?: string;
  status?: string;
}

export const EMPTY_STORE: WorkspaceStore = {
  schemaVersion: 2,
  workspaces: [],
  windowToWorkspace: {},
  deletedWorkspaces: {},
};

export function isConnected(workspace: Workspace): boolean {
  return workspace.live.status === 'connected' && workspace.live.windowId !== undefined;
}

