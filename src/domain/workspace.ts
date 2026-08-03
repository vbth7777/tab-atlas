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
  indigo: { label: 'Indigo', value: '#6366f1' },
  sky: { label: 'Sky', value: '#0ea5e9' },
  teal: { label: 'Teal', value: '#14b8a6' },
  emerald: { label: 'Emerald', value: '#10b981' },
  amber: { label: 'Amber', value: '#f59e0b' },
  orange: { label: 'Orange', value: '#f97316' },
  rose: { label: 'Rose', value: '#f43f5e' },
  violet: { label: 'Violet', value: '#8b5cf6' },
};

export interface SavedTab {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
  hostname: string;
  savedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  color: WorkspaceColor;
  tabs: SavedTab[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStore {
  schemaVersion: 1;
  workspaces: Workspace[];
}

export interface TabSnapshot {
  id: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
}

export const EMPTY_STORE: WorkspaceStore = { schemaVersion: 1, workspaces: [] };
