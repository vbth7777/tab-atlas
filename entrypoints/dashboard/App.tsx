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

function formatHistoryTime(isoTime: string): string {
  try {
    const seconds = Math.floor((Date.now() - new Date(isoTime).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86_400)}d ago`;
  } catch {
    return isoTime;
  }
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

  // History sub-view state
  const [viewMode, setViewMode] = useState<'tabs' | 'history'>('tabs');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'closed' | 'window_closed' | 'visited'>('all');
  const [historySearch, setHistorySearch] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const storeVersion = useWorkspaceStoreVersion();

  const loadAll = async () => {
    try {
      const listRes = await sendMessage({ type: 'list-workspaces' });
      setWorkspaces(listRes.workspaces);
      setSelectedId((current) =>
        current && listRes.workspaces.some((item) => item.id === current) ? current : listRes.workspaces[0]?.id ?? null,
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
    setViewMode('tabs');
  };

  const historyEntries = selected?.history || [];
  const filteredHistory = useMemo(() => {
    return historyEntries.filter((entry) => {
      if (historyFilter === 'closed' && entry.eventType !== 'closed') return false;
      if (historyFilter === 'window_closed' && entry.eventType !== 'window_closed') return false;
      if (historyFilter === 'visited' && entry.eventType !== 'visited' && entry.eventType !== 'opened') return false;
      if (historySearch) {
        const q = historySearch.toLowerCase();
        return (
          entry.title.toLowerCase().includes(q) ||
          entry.url.toLowerCase().includes(q) ||
          entry.hostname.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [historyEntries, historyFilter, historySearch]);

  const handleClearHistory = () => {
    if (!selected) return;
    if (!confirm(`Clear local tab history for “${selected.name}”?`)) return;
    return run(async () => {
      await sendMessage({ type: 'clear-workspace-history', workspaceId: selected.id });
      return 'Workspace tab history cleared.';
    });
  };

  const handleRestoreTab = (url: string, isIncognito?: boolean) => {
    return run(async () => {
      await sendMessage({
        type: 'restore-closed-tab',
        url,
        isIncognito,
        windowId: selected && isConnected(selected) ? selected.live.windowId : undefined,
      });
      return `Restored tab: ${url}`;
    });
  };

  const handleRestoreBatch = (urls: string[], isIncognito?: boolean) => {
    return run(async () => {
      const res = await sendMessage({
        type: 'restore-closed-batch',
        urls,
        isIncognito,
        windowId: selected && isConnected(selected) ? selected.live.windowId : undefined,
      });
      return `Restored ${res.count} closed tabs.`;
    });
  };

  const run = async (action: () => Promise<string>) => {
    try {
      setNotice(await action());
      await loadAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Something went wrong.');
    }
  };

  const remove = (workspace: Workspace) => {
    if (!confirm(`Delete “${workspace.name}”? Tabs in open windows will not close.`)) return;
    return run(async () => {
      await sendMessage({ type: 'delete-workspace', workspaceId: workspace.id });
      return `Deleted “${workspace.name}”.`;
    });
  };

  const submitMetadata = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    return run(async () => {
      const response = await sendMessage({
        type: 'update-workspace',
        workspaceId: selected.id,
        name: name.trim() || selected.name,
        color,
      });
      setEditing(false);
      return `Renamed to “${response.workspace.name}”.`;
    });
  };

  const exportJson = () => {
    return run(async () => {
      const res = await sendMessage({ type: 'export-workspaces' });
      const blob = new Blob([res.storeJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tab-atlas-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return 'Exported workspaces JSON backup.';
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

  const navSection = (title: string, list: Workspace[]) => list.length === 0 ? null : <>
    <p className="nav-heading">{title}</p>
    <nav className="workspace-nav">{list.map((workspace) => <button
      key={workspace.id}
      className={`workspace-link ${workspace.id === selectedId ? 'active' : ''}`}
      onClick={() => select(workspace)}
      title={`${workspace.name} (${workspace.tabs.length} tabs)`}
    >
      <span className={`workspace-color ${workspace.color}`} />
      <span className="nav-workspace-name">{workspace.name}</span>
      {workspace.live.status === 'connected' && workspace.live.isIncognito && (
        <span className="incognito-indicator" title="Live in Incognito mode">
          <Icon name="incognito" size={13} />
        </span>
      )}
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

      <div className="sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="privacy-dot" style={{ background: '#34d399' }} />
          <span>Local & Private Storage</span>
        </div>
      </div>
    </aside>

    <section className="dashboard-content">
      {/* Top Settings Bar */}
      <div className="top-settings-bar">
        <div className="settings-status-group">
          <span className="privacy-dot" style={{ background: '#34d399' }} />
          <span className="settings-status-text">
            <strong>Local & Offline Edition</strong>
          </span>
        </div>

        <div className="settings-actions-group">
          <button className="ghost-button compact" onClick={exportJson} title="Export all workspaces to JSON">
            <span>Export JSON</span>
          </button>
          <button className="ghost-button compact" onClick={() => fileInputRef.current?.click()} title="Import workspaces from JSON file">
            <span>Import JSON</span>
          </button>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          accept=".json"
          onChange={handleFileImport}
          style={{ display: 'none' }}
        />
      </div>

      <header className="dashboard-header">
        <div><p className="eyebrow">TAB ATLAS COMMUNITY EDITION</p><h1>Every workspace stays current.</h1></div>
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

        {/* View Switcher: Active Tabs vs History & Closed */}
        <div className="view-tabs">
          <button
            type="button"
            className={`view-tab-btn ${viewMode === 'tabs' ? 'active' : ''}`}
            onClick={() => setViewMode('tabs')}
          >
            <Icon name="layout" size={14} />
            <span>Active Tabs</span>
            <span className="view-tab-badge">{selected.tabs.length}</span>
          </button>
          <button
            type="button"
            className={`view-tab-btn ${viewMode === 'history' ? 'active' : ''}`}
            onClick={() => setViewMode('history')}
          >
            <Icon name="history" size={14} />
            <span>Local Tab History</span>
            <span className="view-tab-badge">{historyEntries.length}</span>
          </button>
        </div>

        {viewMode === 'tabs' ? (
          <div className="tab-list">
            {selected.tabs.map((tab) => <article className="saved-tab" key={tab.id}>
              <div className="favicon">{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : tab.hostname[0]?.toUpperCase()}</div>
              <div className="tab-copy"><h3>{tab.title}</h3><p>{tab.hostname}<span>·</span>{tab.url}</p></div>
              <button className="open-tab" onClick={() => sendMessage({ type: 'open-tab', url: tab.url })} aria-label={`Open ${tab.title}`}><Icon name="arrow-up-right" /></button>
            </article>)}
            {!selected.tabs.length && <p className="empty-copy">This workspace has no web tabs right now.</p>}
          </div>
        ) : (
          <div>
            <div className="history-controls">
              <div className="filter-chips">
                <button
                  type="button"
                  className={`filter-chip ${historyFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setHistoryFilter('all')}
                >
                  All ({historyEntries.length})
                </button>
                <button
                  type="button"
                  className={`filter-chip ${historyFilter === 'closed' ? 'active' : ''}`}
                  onClick={() => setHistoryFilter('closed')}
                >
                  Closed Tabs ({historyEntries.filter((h) => h.eventType === 'closed').length})
                </button>
                <button
                  type="button"
                  className={`filter-chip ${historyFilter === 'window_closed' ? 'active' : ''}`}
                  onClick={() => setHistoryFilter('window_closed')}
                >
                  Window Sessions ({historyEntries.filter((h) => h.eventType === 'window_closed').length})
                </button>
                <button
                  type="button"
                  className={`filter-chip ${historyFilter === 'visited' ? 'active' : ''}`}
                  onClick={() => setHistoryFilter('visited')}
                >
                  Visited ({historyEntries.filter((h) => h.eventType === 'visited' || h.eventType === 'opened').length})
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Filter history..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '11px', borderRadius: '6px', width: '150px' }}
                />
                {historyEntries.length > 0 && (
                  <button className="text-button" style={{ fontSize: '11px', color: '#fb7185' }} onClick={handleClearHistory}>
                    Clear History
                  </button>
                )}
              </div>
            </div>

            <div className="history-list">
              {filteredHistory.map((item, idx) => {
                const isBatchStart = item.batchId && (idx === 0 || filteredHistory[idx - 1]?.batchId !== item.batchId);
                const batchItems = item.batchId ? filteredHistory.filter((h) => h.batchId === item.batchId) : [];

                if (item.eventType === 'window_closed') {
                  const count = item.tabCount ?? item.tabsSnapshot?.length ?? 0;
                  const sessionUrls = item.tabsSnapshot?.map((t) => t.url) || selected.tabs.map((t) => t.url);
                  return (
                    <article className="history-entry" key={item.id} style={{ background: 'rgba(251, 191, 36, 0.04)', borderColor: 'rgba(251, 191, 36, 0.2)' }}>
                      <div className="favicon" style={{ background: '#291e0a', borderColor: '#785a10', color: '#fbbf24' }}>
                        <Icon name="layout" size={14} />
                      </div>
                      <div className="tab-copy">
                        <h3>
                          <span>{item.title}</span>
                          <span className="history-type-badge window_closed">
                            Window Session
                          </span>
                          {item.isIncognito && (
                            <span className="history-type-badge closed" style={{ background: '#231942', color: '#c4b5fd', borderColor: '#5b21b6' }}>
                              Incognito
                            </span>
                          )}
                          <span className="history-time">{formatHistoryTime(item.timestamp)}</span>
                        </h3>
                        <p>Snapshot of {count} tabs when workspace window was closed</p>
                      </div>
                      <div className="history-actions">
                        <button
                          className="restore-btn"
                          style={{ borderColor: '#785a10', background: '#36280b', color: '#fde68a' }}
                          onClick={() => handleRestoreBatch(sessionUrls, item.isIncognito)}
                          title="Reopen all tabs from this closed window session"
                        >
                          <Icon name="rotate-ccw" size={12} />
                          <span>Reopen Window ({count})</span>
                        </button>
                      </div>
                    </article>
                  );
                }

                return (
                  <div key={item.id}>
                    {isBatchStart && batchItems.length > 1 && (
                      <div className="batch-group-header">
                        <span>
                          <Icon name="layers" size={13} /> Batch closure: {batchItems.length} tabs closed together
                        </span>
                        <button
                          type="button"
                          className="restore-btn"
                          onClick={() => handleRestoreBatch(batchItems.map((b) => b.url), item.isIncognito)}
                        >
                          <Icon name="rotate-ccw" size={12} />
                          <span>Restore all {batchItems.length} tabs</span>
                        </button>
                      </div>
                    )}
                    <article className="history-entry">
                      <div className="favicon">{item.faviconUrl ? <img src={item.faviconUrl} alt="" /> : item.hostname[0]?.toUpperCase()}</div>
                      <div className="tab-copy">
                        <h3>
                          <span>{item.title}</span>
                          <span className={`history-type-badge ${item.eventType}`}>
                            {item.eventType}
                          </span>
                          {item.isIncognito && (
                            <span className="history-type-badge closed" style={{ background: '#231942', color: '#c4b5fd', borderColor: '#5b21b6' }}>
                              Incognito
                            </span>
                          )}
                          <span className="history-time">{formatHistoryTime(item.timestamp)}</span>
                        </h3>
                        <p>{item.hostname}<span>·</span>{item.url}</p>
                      </div>
                      <div className="history-actions">
                        <button
                          className="restore-btn"
                          onClick={() => handleRestoreTab(item.url, item.isIncognito)}
                          title="Reopen this tab"
                        >
                          <Icon name="rotate-ccw" size={12} />
                          <span>Restore</span>
                        </button>
                      </div>
                    </article>
                  </div>
                );
              })}
              {!filteredHistory.length && (
                <p className="empty-copy">No history records found for this workspace.</p>
              )}
            </div>
          </div>
        )}
      </section>}
    </section>
  </main>;
}
