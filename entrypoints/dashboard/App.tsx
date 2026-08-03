import { useEffect, useMemo, useState } from 'react';
import { isConnected, type Workspace, type WorkspaceColor } from '@/src/domain/workspace';
import { filterWorkspaces } from '@/src/domain/workspace-service';
import { sendMessage } from '@/src/shared/messages';
import { ColorPicker, Icon, WorkspaceBadge } from '@/src/ui/components';
import { useWorkspaceStoreVersion } from '@/src/ui/use-workspace-store-version';
import '@/src/ui/app.css';

function syncedLabel(workspace: Workspace) {
  if (!workspace.live.lastSyncedAt) return 'Not synced yet';

  const seconds = Math.floor((Date.now() - new Date(workspace.live.lastSyncedAt).getTime()) / 1000);
  if (seconds < 60) return 'Synced just now';
  if (seconds < 3600) return `Synced ${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `Synced ${Math.floor(seconds / 3600)} h ago`;
  return `Synced ${Math.floor(seconds / 86_400)} d ago`;
}

export default function Dashboard() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<WorkspaceColor>('indigo');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const storeVersion = useWorkspaceStoreVersion();

  useEffect(() => {
    let cancelled = false;

    sendMessage({ type: 'list-workspaces' })
      .then((response) => {
        if (cancelled) return;
        setWorkspaces(response.workspaces);
        setSelectedId((current) =>
          current && response.workspaces.some((item) => item.id === current) ? current : response.workspaces[0]?.id ?? null,
        );
        setLoading(false);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setNotice(error.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [storeVersion]);

  const filtered = useMemo(() => filterWorkspaces(workspaces, query), [workspaces, query]);
  const live = filtered.filter(isConnected);
  const closed = filtered.filter((workspace) => !isConnected(workspace));
  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? null;

  const select = (workspace: Workspace) => {
    setSelectedId(workspace.id);
    setEditing(false);
    setName(workspace.name);
    setColor(workspace.color);
  };

  const run = async (action: () => Promise<string>) => {
    try {
      setNotice(await action());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Something went wrong.');
    }
  };

  const remove = (workspace: Workspace) => {
    if (!confirm(`Delete “${workspace.name}”? Saved tabs are removed from Tab Atlas. Open browser tabs stay open.`)) return;
    return run(async () => {
      await sendMessage({ type: 'delete-workspace', workspaceId: workspace.id });
      return 'Workspace deleted.';
    });
  };

  const submitMetadata = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    return run(async () => {
      await sendMessage({ type: 'update-workspace', workspaceId: selected.id, name, color });
      setEditing(false);
      return 'Workspace details updated.';
    });
  };

  const navSection = (label: string, items: Workspace[]) => items.length > 0 && <>
    <div className="sidebar-label">{label} <span>{items.length}</span></div>
    <nav className="workspace-nav">{items.map((workspace) => <button
      className={`nav-workspace ${selected?.id === workspace.id ? 'active' : ''}`}
      key={workspace.id}
      onClick={() => select(workspace)}
    >
      <span className={`workspace-color ${workspace.color}`} />
      <span>{workspace.name}</span>
      <small>{workspace.tabs.length}</small>
    </button>)}</nav>
  </>;

  return <main className="dashboard-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark"><Icon name="layout" /></span><span>Tab Atlas</span></div>
      <button className="new-capture" onClick={() => setNotice('Open Tab Atlas from the Chrome toolbar to turn a window into a live workspace.')}><Icon name="plus" />New live workspace</button>
      {navSection('LIVE NOW', live)}
      {navSection('WINDOW CLOSED', closed)}
      {!filtered.length && !loading && <p className="empty-copy">No workspaces match this search.</p>}
      <div className="sidebar-footer"><span>Local-only vault</span><span className="privacy-dot" />No account required</div>
    </aside>

    <section className="dashboard-content">
      <header className="dashboard-header">
        <div><p className="eyebrow">YOUR LIVE TAB LIBRARY</p><h1>Every workspace stays current.</h1></div>
        <label className="search-field">
          <Icon name="search" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspaces, tabs or domains" />
        </label>
      </header>

      {notice && <p className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><Icon name="x" size={16} /></button></p>}

      {loading ? <p className="empty-copy">Loading workspaces…</p> : !selected ? <section className="dashboard-empty">
        <span className="empty-icon"><Icon name="archive" size={28} /></span>
        <h2>No workspaces yet</h2>
        <p>Open Tab Atlas from Chrome’s toolbar to turn the window you are browsing into a live workspace. Tabs you open or close are saved automatically.</p>
      </section> : <section className="workspace-detail">
        <div className="detail-toolbar">
          <div>{editing ? <form className="inline-edit" onSubmit={submitMetadata}>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label="Workspace name" />
            <ColorPicker value={color} onChange={setColor} />
            <button className="primary-button compact" type="submit">Save</button>
            <button className="ghost-button" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </form> : <>
            <div className="detail-title">
              <span className={`large-color ${selected.color}`} />
              <h2>{selected.name}</h2>
              <WorkspaceBadge workspace={selected} />
              <button className="tiny-button" onClick={() => { setName(selected.name); setColor(selected.color); setEditing(true); }}>Edit</button>
            </div>
            <p>{selected.tabs.length} tabs · {syncedLabel(selected)}</p>
          </>}</div>

          <div className="detail-actions">
            <button className="ghost-button" onClick={() => remove(selected)}><Icon name="trash" />Delete</button>
            {isConnected(selected) && <button className="ghost-button" onClick={() => run(async () => {
              const response = await sendMessage({ type: 'detach-workspace', workspaceId: selected.id });
              return `“${response.workspace.name}” no longer tracks its window.`;
            })}><Icon name="unlink" />Detach</button>}
            <button className="primary-button compact" onClick={() => run(async () => {
              await sendMessage({ type: 'activate-workspace', workspaceId: selected.id });
              return isConnected(selected) ? `Switched to “${selected.name}”.` : `Opened “${selected.name}” in its own window.`;
            })}><Icon name={isConnected(selected) ? 'arrow-up-right' : 'copy'} />{isConnected(selected) ? 'Switch to workspace' : 'Open workspace'}</button>
          </div>
        </div>

        <div className="tab-list">{selected.tabs.map((tab) => <article className="saved-tab" key={tab.id}>
          <div className="favicon">{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : tab.hostname[0]?.toUpperCase()}</div>
          <div className="tab-copy"><h3>{tab.title}</h3><p>{tab.hostname}<span>·</span>{tab.url}</p></div>
          <button className="open-tab" onClick={() => sendMessage({ type: 'open-tab', url: tab.url })} aria-label={`Open ${tab.title}`}><Icon name="arrow-up-right" /></button>
        </article>)}
        {!selected.tabs.length && <p className="empty-copy">This workspace has no web tabs right now.</p>}</div>
      </section>}
    </section>
  </main>;
}
