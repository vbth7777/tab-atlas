import type { Workspace, WorkspaceColor } from '@/src/domain/workspace';

export type ExtensionMessage =
  | { type: 'list-workspaces' }
  | { type: 'get-window-context' }
  | { type: 'create-live-workspace'; name: string; color: WorkspaceColor }
  | { type: 'activate-workspace'; workspaceId: string }
  | { type: 'sync-workspace'; workspaceId: string }
  | { type: 'detach-workspace'; workspaceId: string }
  | { type: 'open-tab'; url: string }
  | { type: 'update-workspace'; workspaceId: string; name: string; color: WorkspaceColor }
  | { type: 'delete-workspace'; workspaceId: string }
  | { type: 'open-dashboard' };

/** Describes the window the UI is acting on, so it can offer the right action. */
export interface WindowContext {
  windowId: number | null;
  webTabCount: number;
  workspace: Workspace | null;
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
}

export type ExtensionResponse = MessageMap[keyof MessageMap] | { ok: false; error: string };

export async function sendMessage<T extends ExtensionMessage>(message: T): Promise<MessageMap[T['type']]> {
  const response = await browser.runtime.sendMessage(message) as MessageMap[T['type']] | { ok: false; error: string };
  if (!response.ok) throw new Error(response.error);
  return response;
}
