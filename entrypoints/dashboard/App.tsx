import { useEffect, useMemo, useState } from 'react';
import type { Workspace, WorkspaceColor } from '@/src/domain/workspace';
import { filterWorkspaces } from '@/src/domain/workspace-service';
import { sendMessage } from '@/src/shared/messages';
import { ColorPicker, Icon } from '@/src/ui/components';
import '@/src/ui/app.css';

function relativeDate(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}

export default function Dashboard() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<WorkspaceColor>('indigo');
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    const response = await sendMessage({ type: 'list-workspaces' });
    setWorkspaces(response.workspaces);
    setSelectedId((current) => current && response.workspaces.some((item) => item.id === current) ? current : response.workspaces[0]?.id ?? null);
  };
  useEffect(() => { queueMicrotask(() => { refresh().catch((error) => setNotice(error.message)); }); }, []);

  const filtered = useMemo(() => filterWorkspaces(workspaces, query), [workspaces, query]);
  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? null;
  const select = (workspace: Workspace) => { setSelectedId(workspace.id); setEditing(false); setName(workspace.name); setColor(workspace.color); };
  const restore = async (workspaceId: string) => { await sendMessage({ type: 'restore-workspace', workspaceId }); setNotice('Workspace restored in a new tab set.'); };
  const remove = async (workspace: Workspace) => { if (!confirm(`Delete “${workspace.name}”? This cannot be undone.`)) return; await sendMessage({ type: 'delete-workspace', workspaceId: workspace.id }); setNotice('Workspace deleted.'); await refresh(); };
  const submitMetadata = async (event: React.FormEvent) => { event.preventDefault(); if (!selected) return; await sendMessage({ type: 'update-workspace', workspaceId: selected.id, name, color }); setEditing(false); setNotice('Workspace details updated.'); await refresh(); };

  return <main className="dashboard-shell">
    <aside className="sidebar"><div className="sidebar-brand"><span className="brand-mark"><Icon name="layout" /></span><span>Tab Atlas</span></div><button className="new-capture" onClick={() => setNotice('Open Tab Atlas from the Chrome toolbar to capture the current window.')}><Icon name="plus" />Capture a window</button><div className="sidebar-label">WORKSPACES <span>{workspaces.length}</span></div><nav className="workspace-nav">{filtered.map((workspace) => <button className={`nav-workspace ${selected?.id === workspace.id ? 'active' : ''}`} key={workspace.id} onClick={() => select(workspace)}><span className={`workspace-color ${workspace.color}`} /><span>{workspace.name}</span><small>{workspace.tabs.length}</small></button>)}</nav><div className="sidebar-footer"><span>Local-only vault</span><span className="privacy-dot" />No account required</div></aside>
    <section className="dashboard-content"><header className="dashboard-header"><div><p className="eyebrow">YOUR TAB LIBRARY</p><h1>Pick up where you left off.</h1></div><label className="search-field"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspaces, tabs or domains" /><kbd>⌘ K</kbd></label></header>
      {notice && <p className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><Icon name="x" size={16} /></button></p>}
      {!selected ? <section className="dashboard-empty"><span className="empty-icon"><Icon name="archive" size={28} /></span><h2>No saved workspaces yet</h2><p>Open the extension popup from Chrome’s toolbar to capture the tabs in your current window.</p></section> : <section className="workspace-detail"><div className="detail-toolbar"><div>{editing ? <form className="inline-edit" onSubmit={submitMetadata}><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /><ColorPicker value={color} onChange={setColor} /><button className="primary-button compact" type="submit">Save</button><button className="ghost-button" type="button" onClick={() => setEditing(false)}>Cancel</button></form> : <><div className="detail-title"><span className={`large-color ${selected.color}`} /><h2>{selected.name}</h2><button className="tiny-button" onClick={() => { setName(selected.name); setColor(selected.color); setEditing(true); }}>Edit</button></div><p>{selected.tabs.length} tabs · Saved {relativeDate(selected.updatedAt)}</p></>}</div><div className="detail-actions"><button className="ghost-button" onClick={() => remove(selected)}><Icon name="trash" />Delete</button><button className="primary-button compact" onClick={() => restore(selected.id)}><Icon name="copy" />Restore all tabs</button></div></div><div className="tab-list">{selected.tabs.map((tab) => <article className="saved-tab" key={tab.id}><div className="favicon">{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : tab.hostname[0]?.toUpperCase()}</div><div className="tab-copy"><h3>{tab.title}</h3><p>{tab.hostname}<span>·</span>{tab.url}</p></div><button className="open-tab" onClick={() => sendMessage({ type: 'restore-tab', url: tab.url })} aria-label={`Open ${tab.title}`}><Icon name="arrow-up-right" /></button></article>)}</div></section>}</section>
  </main>;
}
