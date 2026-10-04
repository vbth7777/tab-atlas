import type { Workspace, WorkspaceColor, WorkspaceHistoryEntry } from '@/src/domain/workspace';

export type ExtensionMessage =
  | { type: 'list-workspaces' }
  | { type: 'get-window-context' }
  | { type: 'create-live-workspace'; name: string; color: WorkspaceColor }
  | { type: 'activate-workspace'; workspaceId: string; incognito?: boolean }
  | { type: 'sync-workspace'; workspaceId: string }
  | { type: 'detach-workspace'; workspaceId: string }
  | { type: 'open-tab'; url: string }
  | { type: 'update-workspace'; workspaceId: string; name: string; color: WorkspaceColor }
  | { type: 'delete-workspace'; workspaceId: string }
  | { type: 'open-dashboard' }
  | { type: 'import-workspaces'; jsonText: string }
  | { type: 'export-workspaces' }
  | { type: 'restore-closed-tab'; url: string; title?: string; isIncognito?: boolean; windowId?: number }
  | { type: 'restore-closed-batch'; urls: string[]; isIncognito?: boolean; windowId?: number }
  | { type: 'clear-workspace-history'; workspaceId: string }
  | { type: 'get-recently-closed'; workspaceId?: string }
  | { type: 'deduplicate-workspace'; workspaceId: string; targetUrls?: string[] }
  | {
      type: 'add-tabs-to-workspace';
      workspaceId: string;
      tabs: Array<{ id?: number; url: string; title?: string; faviconUrl?: string }>;
      closeSourceTabIds?: number[];
    }
  | {
      type: 'split-workspace';
      parentWorkspaceId: string;
      splitMode: 'by_tab_count' | 'by_child_count';
      value: number;
      childNamePrefix?: string;
      colors?: WorkspaceColor[];
      moveTabs?: boolean;
    }
  | {
      type: 'merge-children-to-parent';
      parentWorkspaceId: string;
      deleteChildren?: boolean;
    }
  | {
      type: 'create-child-workspace';
      parentId: string;
      name: string;
      color?: WorkspaceColor;
      initialTabs?: Array<{ url: string; title?: string; faviconUrl?: string }>;
      removeTabsFromParent?: boolean;
    }
  | {
      type: 'move-tabs-between-workspaces';
      sourceWorkspaceId: string;
      targetWorkspaceId: string;
      tabIds: string[];
    }
  | {
      type: 'deduplicate-tree';
      rootWorkspaceId: string;
      targetUrls?: string[];
    }
  | {
      type: 'activate-tree';
      parentWorkspaceId: string;
      incognito?: boolean;
    }
  | {
      type: 'merge-snapshot-to-live';
      workspaceId: string;
      snapshotTabs: Array<{ url: string; title?: string; faviconUrl?: string }>;
      windowId?: number;
    }
  | {
      type: 'resolve-mass-drop';
      workspaceId: string;
      action: 'restore_missing' | 'accept_current';
    };

/** Describes the window the UI is acting on, so it can offer the right action. */
export interface WindowContext {
  windowId: number | null;
  webTabCount: number;
  workspace: Workspace | null;
}

export interface WatchdogAuditLogEntry {
  timestamp: string;
  tabId: number;
  workspaceId: string;
  workspaceName: string;
  recoveredUrl: string;
}

export interface MessageMap {
  'list-workspaces': { ok: true; workspaces: Workspace[] };
  'get-window-context': { ok: true; context: WindowContext };
  'create-live-workspace': { ok: true; workspace: Workspace };
  'activate-workspace': { ok: true; workspace: Workspace };
  'sync-workspace': { ok: true; workspace: Workspace };
  'detach-workspace': { ok: true; workspace: Workspace };
  'open-tab': { ok: true };
  'update-workspace': { ok: true; workspace: Workspace };
  'delete-workspace': { ok: true };
  'open-dashboard': { ok: true };
  'import-workspaces': { ok: true; message: string };
  'export-workspaces': { ok: true; storeJson: string };
  'restore-closed-tab': { ok: true };
  'restore-closed-batch': { ok: true; count: number };
  'clear-workspace-history': { ok: true; workspace: Workspace };
  'get-recently-closed': { ok: true; entries: WorkspaceHistoryEntry[] };
  'deduplicate-workspace': { ok: true; workspace: Workspace; removedCount: number; affectedGroups: number };
  'add-tabs-to-workspace': { ok: true; workspace: Workspace; addedCount: number };
  'split-workspace': { ok: true; parent: Workspace; children: Workspace[] };
  'merge-children-to-parent': { ok: true; parent: Workspace; mergedTabsCount: number; affectedChildrenCount: number };
  'create-child-workspace': { ok: true; workspace: Workspace };
  'move-tabs-between-workspaces': { ok: true; source: Workspace; target: Workspace; movedCount: number };
  'deduplicate-tree': { ok: true; affectedWorkspacesCount: number; totalRemovedCount: number };
  'activate-tree': { ok: true; openedCount: number };
  'merge-snapshot-to-live': { ok: true; restoredCount: number; workspace: Workspace };
  'resolve-mass-drop': { ok: true; workspace: Workspace; restoredCount?: number };
  'get-watchdog-logs': { ok: true; logs: WatchdogAuditLogEntry[] };
}

export type ExtensionResponse = MessageMap[keyof MessageMap] | { ok: false; error: string };

export async function sendMessage<T extends ExtensionMessage>(message: T): Promise<MessageMap[T['type']]> {
  let response: ExtensionResponse | undefined;
  try {
    response = (await browser.runtime.sendMessage(message)) as ExtensionResponse | undefined;
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Không thể kết nối đến Service Worker của tiện ích.');
  }

  if (!response) {
    throw new Error('Không nhận được phản hồi từ tiện ích. Vui lòng tải lại trang hoặc tiện ích.');
  }

  if (response.ok === false) {
    throw new Error(response.error || 'Thao tác không thành công.');
  }

  return response as MessageMap[T['type']];
}
