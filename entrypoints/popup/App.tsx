import { useEffect, useState } from 'react';
import type { Workspace, WorkspaceColor } from '@/src/domain/workspace';
import { sendMessage } from '@/src/shared/messages';
import { ColorPicker, Icon } from '@/src/ui/components';
import '@/src/ui/app.css';

export default function App() {
  const [name, setName] = useState('');
  const [color, setColor] = useState<WorkspaceColor>('indigo');
  const [closeAfterSave, setCloseAfterSave] = useState(false);
  const [tabCount, setTabCount] = useState(0);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    const [list, tabs] = await Promise.all([sendMessage({ type: 'list-workspaces' }), sendMessage({ type: 'get-current-tabs' })]);
    setWorkspaces(list.workspaces);
    setTabCount(tabs.tabs.filter((tab) => /^https?:\/\//.test(tab.url ?? '')).length);
  };

  useEffect(() => { refresh().catch((error) => setStatus(error.message)); }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setStatus('');
    try {
      const response = await sendMessage({ type: 'save-current-window', name: name || `Workspace · ${new Date().toLocaleDateString()}`, color, closeAfterSave });
      setName(''); setStatus(`Saved ${response.workspace.tabs.length} tabs.`); await refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save workspace.'); }
    finally { setSaving(false); }
  };

  return <main className="popup-shell">
    <header className="brand-line"><span className="brand-mark"><Icon name="layout" size={16} /></span><span>Tab Atlas</span><button className="icon-button" onClick={() => sendMessage({ type: 'open-dashboard' })} aria-label="Open dashboard"><Icon name="arrow-up-right" /></button></header>
    <section className="popup-hero"><p className="eyebrow">CURRENT WINDOW</p><h1>{tabCount} web tabs ready to save</h1><p>Capture this context now, return to it exactly when you need it.</p></section>
    <form className="save-form" onSubmit={save}>
      <label>Workspace name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Research sprint" maxLength={80} /></label>
      <div className="form-row"><ColorPicker value={color} onChange={setColor} /><label className="check-label"><input type="checkbox" checked={closeAfterSave} onChange={(event) => setCloseAfterSave(event.target.checked)} /> Close tabs after saving</label></div>
      <button className="primary-button" type="submit" disabled={saving || !tabCount}><Icon name="archive" />{saving ? 'Saving…' : 'Save current window'}</button>
    </form>
    {status && <p className="status-message" role="status">{status}</p>}
    <section className="recent-section"><div className="section-heading"><h2>Recent workspaces</h2><button className="text-button" onClick={() => sendMessage({ type: 'open-dashboard' })}>View all</button></div>{workspaces.slice(0, 4).map((workspace) => <button className="workspace-row" key={workspace.id} onClick={() => sendMessage({ type: 'restore-workspace', workspaceId: workspace.id })}><span className={`workspace-color ${workspace.color}`} /><span className="workspace-row-copy"><strong>{workspace.name}</strong><small>{workspace.tabs.length} tabs · {new Date(workspace.updatedAt).toLocaleDateString()}</small></span><Icon name="chevron-right" /></button>)}{!workspaces.length && <p className="empty-copy">Your saved workspaces will live here.</p>}</section>
  </main>;
}
