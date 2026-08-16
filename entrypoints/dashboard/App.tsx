import { useEffect, useMemo, useRef, useState } from 'react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const storeVersion = useWorkspaceStoreVersion();

  const loadAll = async () => {
    try {
      const response = await sendMessage({ type: 'list-workspaces' });
      setWorkspaces(response.workspaces);
      setSelectedId((current) =>
        current && response.workspaces.some((item) => item.id === current) ? current : response.workspaces[0]?.id ?? null,
      );
      setLoading(false);
    } catch (error: any) {
      setNotice(error.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    loadAll().catch((error: Error) => !cancelled && setNotice(error.message));

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
      await loadAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Something went wrong.');
    }
  };

  const exportJson = () => {
    return run(async () => {
      const res = await sendMessage({ type: 'export-workspaces' });
      const blob = new Blob([res.storeJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tab-atlas-workspaces-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return 'Exported workspaces JSON file.';
    });
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        run(async () => {
          const res = await sendMessage({ type: 'import-workspaces', jsonText: content });
          return res.message;
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
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
      <small>
        {workspace.live.status === 'connected' && workspace.live.isIncognito ? '🕶️ ' : ''}
        {workspace.tabs.length}
      </small>
    </button>)}</nav>
  </>;

  return <main className="dashboard-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark"><Icon name="layout" /></span><span>Tab Atlas</span></div>
      <button className="new-capture" onClick={() => setNotice('Open Tab Atlas from the Chrome toolbar to turn a window into a live workspace.')}><Icon name="plus" />New live workspace</button>
      {navSection('LIVE NOW', live)}
      {navSection('WINDOW CLOSED', closed)}
      {!filtered.length && !loading && <p className="empty-copy">No workspaces match this search.</p>}
      
      <div className="sidebar-footer" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>Local-only vault</span>
          <span className="privacy-dot" />
          <span>No account required</span>
        </div>
        <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
          <button className="ghost-button" style={{ fontSize: '10px', padding: '4px 8px' }} onClick={exportJson}>
            Export JSON
          </button>
          <button className="ghost-button" style={{ fontSize: '10px', padding: '4px 8px' }} onClick={() => fileInputRef.current?.click()}>
            Import JSON
          </button>
        </div>
        <input type="file" ref={fileInputRef} accept=".json" onChange={handleFileImport} style={{ display: 'none' }} />
      </div>
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

      {loading ? <p className="empty-copy">Loading workspaces.</p> : !selected ? <section className="dashboard-empty">
        <span className="empty-icon"><Icon name="archive" size={28} /></span>
        <h2>No workspaces yet</h2>
        <p>Open Tab Atlas from Chrome's toolbar to turn the window you are browsing into a live workspace. Tabs you open or close are saved automatically.</p>
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
            <button
              className="primary-button compact"
              onClick={() => run(async () => {
                const res = await sendMessage({ type: 'activate-workspace', workspaceId: selected.id, incognito: false });
                return isConnected(res.workspace) && !res.workspace.live.isIncognito
                  ? `Switched to “${res.workspace.name}”.`
                  : `Opened “${res.workspace.name}” in a normal window.`;
              })}
            >
              <Icon name={isConnected(selected) && !selected.live.isIncognito ? 'arrow-up-right' : 'copy'} />
              {isConnected(selected) && !selected.live.isIncognito ? 'Switch to window' : 'Open workspace'}
            </button>
            <button
              className="ghost-button compact incognito-button"
              onClick={() => run(async () => {
                const res = await sendMessage({ type: 'activate-workspace', workspaceId: selected.id, incognito: true });
                return isConnected(res.workspace) && res.workspace.live.isIncognito
                  ? `Switched to Incognito window for “${res.workspace.name}”.`
                  : `Opened “${res.workspace.name}” in Incognito window.`;
              })}
              title="Open workspace in an Incognito window"
            >
              <Icon name="incognito" size={15} />
              {isConnected(selected) && selected.live.isIncognito ? 'Switch to Incognito' : 'Open in Incognito'}
            </button>
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
