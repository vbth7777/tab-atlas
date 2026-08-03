import type { Workspace, WorkspaceColor } from '@/src/domain/workspace';

export type ExtensionMessage =
  | { type: 'list-workspaces' }
  | { type: 'get-current-tabs' }
  | { type: 'save-current-window'; name: string; color: WorkspaceColor; closeAfterSave: boolean }
  | { type: 'restore-workspace'; workspaceId: string }
  | { type: 'restore-tab'; url: string }
  | { type: 'update-workspace'; workspaceId: string; name: string; color: WorkspaceColor }
  | { type: 'delete-workspace'; workspaceId: string }
  | { type: 'open-dashboard' };

export interface MessageMap {
  'list-workspaces': { ok: true; workspaces: Workspace[] };
  'get-current-tabs': { ok: true; tabs: Array<{ id: number; title?: string; url?: string }> };
  'save-current-window': { ok: true; workspace: Workspace };
  'restore-workspace': { ok: true };
  'restore-tab': { ok: true };
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
