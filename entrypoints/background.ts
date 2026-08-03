import { ChromeLocalWorkspaceRepository } from '@/src/data/chrome-local-workspace-repository';
import { saveWorkspaceFromTabs, updateWorkspaceMetadata } from '@/src/domain/workspace-service';
import type { ExtensionMessage, ExtensionResponse } from '@/src/shared/messages';

const repository = new ChromeLocalWorkspaceRepository();

async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'list-workspaces':
      return { ok: true, workspaces: await repository.list() };

    case 'get-current-tabs': {
      const tabs = await browser.tabs.query({ currentWindow: true });
      return { ok: true, tabs: tabs.filter((tab): tab is typeof tab & { id: number } => tab.id !== undefined) };
    }

    case 'save-current-window': {
      const tabs = await browser.tabs.query({ currentWindow: true });
      const workspace = await saveWorkspaceFromTabs(repository, { name: message.name, color: message.color, tabs: tabs.filter((tab): tab is typeof tab & { id: number } => tab.id !== undefined) });

      if (message.closeAfterSave) {
        const ids = tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined);
        if (ids.length) await browser.tabs.remove(ids);
      }

      return { ok: true, workspace };
    }

    case 'restore-workspace': {
      const workspace = await repository.get(message.workspaceId);
      if (!workspace) throw new Error('Workspace not found.');
      await browser.windows.create({ url: workspace.tabs.map((tab) => tab.url) });
      return { ok: true };
    }

    case 'restore-tab':
      await browser.tabs.create({ url: message.url });
      return { ok: true };

    case 'update-workspace':
      return { ok: true, workspace: await updateWorkspaceMetadata(repository, { id: message.workspaceId, name: message.name, color: message.color }) };

    case 'delete-workspace':
      await repository.remove(message.workspaceId);
      return { ok: true };

    case 'open-dashboard':
      await browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html' as any) });
      return { ok: true };
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: ExtensionMessage) =>
    handleMessage(message).catch((error: unknown): ExtensionResponse => ({
      ok: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred.',
    })),
  );
});
