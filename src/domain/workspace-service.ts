import type { SavedTab, TabSnapshot, Workspace, WorkspaceColor } from '@/src/domain/workspace';
import type { WorkspaceRepository } from '@/src/data/workspace-repository';

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toSavedTab(tab: TabSnapshot): SavedTab | null {
  if (!tab.url || !/^https?:\/\//.test(tab.url)) return null;

  let hostname = tab.url;
  try {
    hostname = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {
    // Ignore malformed URLs; Chrome will still receive them when restored.
  }

  return {
    id: createId('tab'),
    title: tab.title?.trim() || hostname,
    url: tab.url,
    faviconUrl: tab.favIconUrl,
    hostname,
    savedAt: new Date().toISOString(),
  };
}

export async function saveWorkspaceFromTabs(
  repository: WorkspaceRepository,
  input: { name: string; color: WorkspaceColor; tabs: TabSnapshot[] },
): Promise<Workspace> {
  const name = input.name.trim();
  if (!name) throw new Error('Workspace name is required.');

  const tabs = input.tabs.map(toSavedTab).filter((tab): tab is SavedTab => tab !== null);
  if (!tabs.length) throw new Error('There are no saveable web tabs in this window.');

  const now = new Date().toISOString();
  const workspace: Workspace = {
    id: createId('workspace'),
    name,
    color: input.color,
    tabs,
    createdAt: now,
    updatedAt: now,
  };

  await repository.save(workspace);
  return workspace;
}

export async function updateWorkspaceMetadata(
  repository: WorkspaceRepository,
  input: { id: string; name: string; color: WorkspaceColor },
): Promise<Workspace> {
  const workspace = await repository.get(input.id);
  if (!workspace) throw new Error('Workspace not found.');

  const name = input.name.trim();
  if (!name) throw new Error('Workspace name is required.');

  const updated = { ...workspace, name, color: input.color, updatedAt: new Date().toISOString() };
  await repository.save(updated);
  return updated;
}

export function filterWorkspaces(workspaces: Workspace[], query: string): Workspace[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return workspaces;

  return workspaces.filter((workspace) =>
    [workspace.name, ...workspace.tabs.flatMap((tab) => [tab.title, tab.url, tab.hostname])]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalized),
  );
}
