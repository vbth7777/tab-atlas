import { useEffect, useState } from 'react';
import type { Workspace, WorkspaceColor } from '@/src/domain/workspace';
import { sendMessage, type WindowContext } from '@/src/shared/messages';
import { ColorPicker, Icon, WorkspaceBadge } from '@/src/ui/components';
import { useWorkspaceStoreVersion } from '@/src/ui/use-workspace-store-version';
import '@/src/ui/app.css';

export default function App() {
  const [name, setName] = useState('');
  const [color, setColor] = useState<WorkspaceColor>('indigo');
  const [context, setContext] = useState<WindowContext | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const storeVersion = useWorkspaceStoreVersion();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [list, windowContext] = await Promise.all([
        sendMessage({ type: 'list-workspaces' }),
        sendMessage({ type: 'get-window-context' }),
      ]);

      if (cancelled) return;
      setWorkspaces(list.workspaces);
      setContext(windowContext.context);
    };

    load().catch((error: Error) => !cancelled && setStatus(error.message));
    return () => { cancelled = true; };
  }, [storeVersion]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setStatus('');
    try {
      setStatus(await action());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const response = await sendMessage({
        type: 'create-live-workspace',
        name: name || `Workspace · ${new Date().toLocaleDateString()}`,
        color,
      });
      setName('');
      return `“${response.workspace.name}” now tracks this window live.`;
    });
  };

  const linked = context?.workspace ?? null;

  return <main className="popup-shell">
    <header className="brand-line">
      <span className="brand-mark"><Icon name="layout" size={16} /></span>
      <span>Tab Atlas</span>
      <button className="icon-button" onClick={() => sendMessage({ type: 'open-dashboard' })} aria-label="Open dashboard"><Icon name="arrow-up-right" /></button>
    </header>

    {linked ? <>
      <section className="popup-hero">
        <p className="eyebrow">THIS WINDOW</p>
        <div className="detail-title"><span className={`large-color ${linked.color}`} /><h1>{linked.name}</h1></div>
        <WorkspaceBadge workspace={linked} />
        <p>{context?.webTabCount ?? 0} web tabs are tracked here. Opening or closing tabs updates this workspace automatically.</p>
      </section>
      <div className="stacked-actions">
        <button className="primary-button" disabled={busy} onClick={() => run(async () => {
          const response = await sendMessage({ type: 'sync-workspace', workspaceId: linked.id });
          return `Synced ${response.workspace.tabs.length} tabs.`;
        })}><Icon name="refresh" />Sync now</button>
        <button className="ghost-button wide" disabled={busy} onClick={() => run(async () => {
          const response = await sendMessage({ type: 'detach-workspace', workspaceId: linked.id });
          return `“${response.workspace.name}” no longer tracks this window.`;
        })}><Icon name="unlink" />Stop tracking this window</button>
      </div>
    </> : <>
      <section className="popup-hero">
        <p className="eyebrow">CURRENT WINDOW</p>
        <h1>{context?.webTabCount ?? 0} web tabs ready to track</h1>
        <p>Create a live workspace and this window keeps itself up to date as you browse.</p>
      </section>
      <form className="save-form" onSubmit={create}>
        <label>Workspace name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Research sprint" maxLength={80} /></label>
        <div className="form-row"><ColorPicker value={color} onChange={setColor} /></div>
        <button className="primary-button" type="submit" disabled={busy || !context?.webTabCount}><Icon name="archive" />{busy ? 'Working…' : 'Start live workspace'}</button>
      </form>
    </>}

    {status && <p className="status-message" role="status">{status}</p>}

    <section className="recent-section">
      <div className="section-heading"><h2>Workspaces</h2><button className="text-button" onClick={() => sendMessage({ type: 'open-dashboard' })}>View all</button></div>
      {workspaces.slice(0, 4).map((workspace) => <button
        className="workspace-row"
        key={workspace.id}
        disabled={busy}
        onClick={() => run(async () => {
          await sendMessage({ type: 'activate-workspace', workspaceId: workspace.id });
          return `Switched to “${workspace.name}”.`;
        })}
      >
        <span className={`workspace-color ${workspace.color}`} />
        <span className="workspace-row-copy">
          <strong>{workspace.name}</strong>
          <small>{workspace.tabs.length} tabs · {workspace.live.status === 'connected' ? 'Live now' : 'Window closed'}</small>
        </span>
        <Icon name="chevron-right" />
      </button>)}
      {!workspaces.length && <p className="empty-copy">Your live workspaces will appear here.</p>}
    </section>
  </main>;
}
