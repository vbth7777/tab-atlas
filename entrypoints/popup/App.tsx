import { useEffect, useRef, useState } from 'react';
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
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const storeVersion = useWorkspaceStoreVersion();

  const PAGE_SIZE = 4;
  const totalPages = Math.max(1, Math.ceil(workspaces.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedWorkspaces = workspaces.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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

  return (
    <main className="popup-shell">
      <header className="brand-line">
        <span className="brand-mark"><Icon name="layout" size={16} /></span>
        <span>Tab Atlas</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button className="ghost-button" style={{ fontSize: '10px', padding: '3px 6px' }} onClick={exportJson} disabled={busy}>Export</button>
          <button className="ghost-button" style={{ fontSize: '10px', padding: '3px 6px' }} onClick={() => fileInputRef.current?.click()} disabled={busy}>Import</button>
          <button className="icon-button" onClick={() => sendMessage({ type: 'open-dashboard' })} aria-label="Open dashboard"><Icon name="arrow-up-right" /></button>
        </div>
      </header>
      <input type="file" ref={fileInputRef} accept=".json" onChange={handleFileImport} style={{ display: 'none' }} />

      {linked ? (
        <>
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
        </>
      ) : (
        <>
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
        </>
      )}

      {status && <p className="status-message" role="status">{status}</p>}

      <section className="recent-section">
        <div className="section-heading">
          <h2>Workspaces ({workspaces.length})</h2>
          <button className="text-button" onClick={() => sendMessage({ type: 'open-dashboard' })}>View all</button>
        </div>
        {paginatedWorkspaces.map((workspace) => (
          <div className="workspace-row-wrapper" key={workspace.id}>
            <button
              className="workspace-row"
              disabled={busy}
              title={`Mở “${workspace.name}” (Cửa sổ thường)`}
              onClick={() =>
                run(async () => {
                  await sendMessage({ type: 'activate-workspace', workspaceId: workspace.id, incognito: false });
                  return `Switched to “${workspace.name}”.`;
                })
              }
            >
              <span className={`workspace-color ${workspace.color}`} />
              <span className="workspace-row-copy">
                <strong>{workspace.name}</strong>
                <small>
                  {workspace.tabs.length} tabs · {workspace.live.status === 'connected' ? (workspace.live.isIncognito ? 'Live (Ẩn danh)' : 'Live now') : 'Window closed'}
                </small>
              </span>
            </button>
            <div className="row-actions">
              <button
                className="row-action-btn"
                disabled={busy}
                title="Mở trong cửa sổ ẩn danh (Incognito)"
                aria-label={`Mở ${workspace.name} ở chế độ ẩn danh`}
                onClick={(e) => {
                  e.stopPropagation();
                  run(async () => {
                    await sendMessage({ type: 'activate-workspace', workspaceId: workspace.id, incognito: true });
                    return `Opened “${workspace.name}” in Incognito mode.`;
                  });
                }}
              >
                <Icon name="incognito" size={14} />
              </button>
            </div>
          </div>
        ))}
        {!workspaces.length && <p className="empty-copy">Your live workspaces will appear here.</p>}

        {totalPages > 1 && (
          <nav className="popup-pagination" aria-label="Workspaces page navigation">
            <span className="pagination-info">
              Page {currentPage} / {totalPages}
            </span>
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                disabled={currentPage <= 1 || busy}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
                title="Previous page"
              >
                <Icon name="chevron-left" size={14} />
              </button>
              {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((num) => (
                <button
                  key={num}
                  className={`pagination-page-btn ${currentPage === num ? 'active' : ''}`}
                  disabled={busy}
                  onClick={() => setPage(num)}
                  aria-label={`Go to page ${num}`}
                  aria-current={currentPage === num ? 'page' : undefined}
                >
                  {num}
                </button>
              ))}
              <button
                className="pagination-btn"
                disabled={currentPage >= totalPages || busy}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
                title="Next page"
              >
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
          </nav>
        )}
      </section>

      <footer className="popup-footer">
        <span>{workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}</span>
        <button
          className="popup-footer-link"
          onClick={() => sendMessage({ type: 'open-dashboard' })}
        >
          <span>Dashboard</span>
          <Icon name="arrow-up-right" size={13} />
        </button>
      </footer>
    </main>
  );
}
