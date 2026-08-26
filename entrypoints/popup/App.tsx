import { useEffect, useState, useMemo, useRef } from 'react';
import type { Workspace, WorkspaceColor, WorkspaceHistoryEntry } from '@/src/domain/workspace';
import { getDuplicateTabGroups, buildWorkspaceTree } from '@/src/domain/workspace-service';
import { sendMessage, type WindowContext } from '@/src/shared/messages';
import { ColorPicker, Icon, WorkspaceBadge, LanguageSwitcher } from '@/src/ui/components';
import { DeduplicateModal } from '@/src/ui/deduplicate-modal';
import { SendTabsModal, type SourceTabItem } from '@/src/ui/send-tabs-modal';
import { CreateChildWorkspaceModal } from '@/src/ui/create-child-workspace-modal';
import { useWorkspaceStoreVersion } from '@/src/ui/use-workspace-store-version';
import { useI18n } from '@/src/shared/i18n';
import '@/src/ui/app.css';

export default function App() {
  const { lang, setLanguage, t } = useI18n();

  const [name, setName] = useState('');
  const [color, setColor] = useState<WorkspaceColor>('indigo');
  const [context, setContext] = useState<WindowContext | null>(null);
  const [currentWindowTabs, setCurrentWindowTabs] = useState<SourceTabItem[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [recentlyClosed, setRecentlyClosed] = useState<WorkspaceHistoryEntry[]>([]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // Tree collapsed parents in popup
  const [collapsedParentIds, setCollapsedParentIds] = useState<Set<string>>(new Set());

  const [showDedupModal, setShowDedupModal] = useState(false);
  const [showSendTabsModal, setShowSendTabsModal] = useState(false);
  const [targetWsForSend, setTargetWsForSend] = useState<string | undefined>(undefined);
  const [showCreateChildModal, setShowCreateChildModal] = useState(false);
  const [selectedParentForChild, setSelectedParentForChild] = useState<Workspace | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const storeVersion = useWorkspaceStoreVersion();

  const loadData = async () => {
    try {
      const [list, windowContext, closedRes, currentTabs] = await Promise.all([
        sendMessage({ type: 'list-workspaces' }),
        sendMessage({ type: 'get-window-context' }),
        sendMessage({ type: 'get-recently-closed' }),
        browser.tabs.query({ currentWindow: true }).catch(() => []),
      ]);

      setWorkspaces(list.workspaces);
      setContext(windowContext.context);
            setRecentlyClosed(closedRes.entries || []);
      setCurrentWindowTabs(
        currentTabs.map((tabItem) => ({
          id: tabItem.id,
          title: tabItem.title,
          url: tabItem.url,
          pendingUrl: (tabItem as any).pendingUrl,
          favIconUrl: tabItem.favIconUrl,
        }))
      );
    } catch (error: any) {
      setStatus(error.message || 'Error loading extension data');
    }
  };

  useEffect(() => {
    let cancelled = false;

    loadData().catch((error: Error) => !cancelled && setStatus(error.message));
    return () => { cancelled = true; };
  }, [storeVersion]);

  // Build tree for popup
  const workspaceTree = useMemo(() => buildWorkspaceTree(workspaces), [workspaces]);

  const PAGE_SIZE = 4;
  const totalPages = Math.max(1, Math.ceil(workspaceTree.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedTree = workspaceTree.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setStatus('');
    try {
      const res = await action();
      setStatus(res);
      await loadData();
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
      a.download = `atlas-tab-workspaces-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return t.popup.exportDone;
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
        name: name || `${t.common.workspace} · ${new Date().toLocaleDateString()}`,
        color,
      });
      setName('');
      return t.popup.nowTracksWindow.replace('{name}', response.workspace.name);
    });
  };

  const lastClosedItem = recentlyClosed[0];
  const lastBatchItems = lastClosedItem?.batchId
    ? recentlyClosed.filter((item) => item.batchId === lastClosedItem.batchId)
    : [];

  const handleQuickUndo = () => {
    if (!lastClosedItem) return;
    return run(async () => {
      if (lastBatchItems.length > 1) {
        const res = await sendMessage({
          type: 'restore-closed-batch',
          urls: lastBatchItems.map((i) => i.url),
          isIncognito: lastBatchItems[0]?.isIncognito,
          windowId: context?.windowId ?? undefined,
        });
        return t.popup.restoredTabsCount.replace('{count}', String(res.count));
      } else {
        await sendMessage({
          type: 'restore-closed-tab',
          url: lastClosedItem.url,
          isIncognito: lastClosedItem.isIncognito,
          windowId: context?.windowId ?? undefined,
        });
        return t.popup.restoredSingleTab.replace('{title}', lastClosedItem.title);
      }
    });
  };

  const linked = context?.workspace ?? null;

  const linkedDuplicates = useMemo(() => {
    return linked ? getDuplicateTabGroups(linked.tabs) : [];
  }, [linked]);

  const linkedRedundantCount = useMemo(() => {
    return linkedDuplicates.reduce((acc, g) => acc + g.redundantCount, 0);
  }, [linkedDuplicates]);

  const handleDeduplicate = async (targetUrls: string[], scope: 'local' | 'tree') => {
    if (!linked) return;
    return run(async () => {
      if (scope === 'tree') {
        const rootId = linked.parentId || linked.id;
        const res = await sendMessage({
          type: 'deduplicate-tree',
          rootWorkspaceId: rootId,
          targetUrls,
        });
        return t.popup.dedupTreeSuccess.replace('{count}', String(res.totalRemovedCount));
      } else {
        const res = await sendMessage({
          type: 'deduplicate-workspace',
          workspaceId: linked.id,
          targetUrls,
        });
        return t.popup.dedupLocalSuccess.replace('{count}', String(res.removedCount));
      }
    });
  };

  const handleSendTabsConfirm = async (
    targetWorkspaceId: string,
    selectedTabs: Array<{ id?: number; url: string; title?: string; faviconUrl?: string }>,
    closeSource: boolean
  ) => {
    return run(async () => {
      const closeSourceTabIds = closeSource
        ? selectedTabs.map((tabItem) => tabItem.id).filter((id): id is number => id !== undefined)
        : undefined;

      const res = await sendMessage({
        type: 'add-tabs-to-workspace',
        workspaceId: targetWorkspaceId,
        tabs: selectedTabs,
        closeSourceTabIds,
      });

      const targetWs = workspaces.find((w) => w.id === targetWorkspaceId);
      return t.popup.addedTabsSuccess
        .replace('{action}', closeSource ? t.popup.actionMoved : t.popup.actionAdded)
        .replace('{count}', String(res.addedCount))
        .replace('{target}', targetWs?.name || t.common.workspace);
    });
  };

  const handleCreateChildConfirm = async (params: {
    parentId: string;
    name: string;
    color: WorkspaceColor;
    initialTabs: Array<{ url: string; title?: string; faviconUrl?: string }>;
    removeTabsFromParent: boolean;
  }) => {
    return run(async () => {
      const res = await sendMessage({
        type: 'create-child-workspace',
        parentId: params.parentId,
        name: params.name,
        color: params.color,
        initialTabs: params.initialTabs,
        removeTabsFromParent: params.removeTabsFromParent,
      });
      return t.dashboard.createdChildSuccess.replace('{name}', res.workspace.name);
    });
  };

  const toggleParentCollapse = (parentId: string) => {
    setCollapsedParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  return (
    <main className="popup-shell">
      <header className="brand-line">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="brand-mark">
            <Icon name="layout" size={16} />
          </span>
          <span>{t.common.appName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <LanguageSwitcher lang={lang} onLanguageChange={setLanguage} variant="compact" />
          <button
            className="icon-button"
            onClick={() => sendMessage({ type: 'open-dashboard' })}
            aria-label={t.popup.openDashboard}
            title={t.popup.openDashboard}
          >
            <Icon name="arrow-up-right" />
          </button>
        </div>
      </header>

      {/* Offline Storage & Quick JSON Tools */}
      <div
        style={{
          margin: '12px 0',
          padding: '8px 12px',
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="privacy-dot" style={{ background: '#34d399' }} />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{t.common.offlineLocal}</span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="ghost-button"
            style={{ fontSize: '10px', padding: '4px 6px' }}
            onClick={exportJson}
            disabled={busy}
            title={t.dashboard.exportJsonTitle}
          >
            {t.dashboard.exportJson}
          </button>
          <button
            className="ghost-button"
            style={{ fontSize: '10px', padding: '4px 6px' }}
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            title={t.dashboard.importJsonTitle}
          >
            {t.dashboard.importJson}
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

      {/* Quick Undo Closed Tab Banner */}
      {lastClosedItem && (
        <div className="popup-undo-banner">
          <div className="popup-undo-info">
            <Icon name="history" size={14} />
            <span className="popup-undo-text">
              {lastBatchItems.length > 1
                ? t.popup.undoClosedBatch.replace('{count}', String(lastBatchItems.length))
                : t.popup.undoClosedSingle.replace('{title}', lastClosedItem.title)}
            </span>
          </div>
          <button
            type="button"
            className="popup-undo-btn"
            onClick={handleQuickUndo}
            disabled={busy}
          >
            <Icon name="undo" size={11} />
            <span>{t.popup.undoButton}</span>
          </button>
        </div>
      )}

      {/* Duplicate Tabs Alert Banner */}
      {linked && linkedDuplicates.length > 0 && (
        <div className="popup-dedup-banner">
          <div className="popup-dedup-info">
            <Icon name="sparkles" size={13} />
            <span>
              {t.popup.duplicateTabsAlert.replace('{count}', String(linkedRedundantCount))}
            </span>
          </div>
          <button
            type="button"
            className="popup-dedup-btn"
            onClick={() => setShowDedupModal(true)}
            disabled={busy}
          >
            <Icon name="filter" size={11} />
            <span>{t.popup.cleanDuplicatesBtn}</span>
          </button>
        </div>
      )}

      {linked ? (
        <>
          <section className="popup-hero">
            <p className="eyebrow">{t.popup.thisWindow}</p>
            <div className="detail-title">
              <span className={`large-color ${linked.color}`} />
              <h1>{linked.name}</h1>
            </div>
            <WorkspaceBadge workspace={linked} lang={lang} />
            <p>
              {t.popup.tabsTrackedHere.replace('{count}', String(context?.webTabCount ?? 0))}
            </p>
          </section>
          <div className="stacked-actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const response = await sendMessage({ type: 'sync-workspace', workspaceId: linked.id });
                  return `Synced ${response.workspace.tabs.length} tabs.`;
                })
              }
            >
              <Icon name="refresh" />
              {t.popup.syncNow}
            </button>
            {workspaces.length > 1 && (
              <button
                className="ghost-button wide"
                disabled={busy}
                onClick={() => {
                  setTargetWsForSend(undefined);
                  setShowSendTabsModal(true);
                }}
                title={t.popup.moveCopyTabs}
              >
                <Icon name="layers" size={14} />
                <span>{t.popup.moveCopyTabs}</span>
              </button>
            )}
            <button
              className="ghost-button wide"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const response = await sendMessage({ type: 'detach-workspace', workspaceId: linked.id });
                  return t.popup.noLongerTracks.replace('{name}', response.workspace.name);
                })
              }
            >
              <Icon name="unlink" />
              {t.popup.stopTracking}
            </button>
          </div>
        </>
      ) : (
        <>
          <section className="popup-hero">
            <p className="eyebrow">{t.popup.currentWindow}</p>
            <h1>{t.popup.tabsReadyToTrack.replace('{count}', String(context?.webTabCount ?? 0))}</h1>
            <p>{t.popup.createLiveHint}</p>
          </section>
          <form className="save-form" onSubmit={create}>
            <label>
              {t.popup.workspaceNameLabel}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.popup.workspaceNamePlaceholder}
                maxLength={80}
              />
            </label>
            <div className="form-row">
              <ColorPicker value={color} onChange={setColor} />
            </div>
            <button className="primary-button" type="submit" disabled={busy || !context?.webTabCount}>
              <Icon name="archive" />
              {busy ? t.common.working : t.popup.startLiveWorkspace}
            </button>
            {workspaces.length > 0 && (
              <button
                type="button"
                className="ghost-button wide"
                style={{ marginTop: '8px' }}
                disabled={busy || !context?.webTabCount}
                onClick={() => {
                  setTargetWsForSend(undefined);
                  setShowSendTabsModal(true);
                }}
                title={t.popup.addTabsToExisting.replace('{count}', String(context?.webTabCount ?? 0))}
              >
                <Icon name="layers" size={14} />
                <span>{t.popup.addTabsToExisting.replace('{count}', String(context?.webTabCount ?? 0))}</span>
              </button>
            )}
          </form>
        </>
      )}

      {status && (
        <p className="status-message" role="status">
          {status}
        </p>
      )}

      {/* Workspaces Tree List in Popup */}
      <section className="recent-section">
        <div className="section-heading">
          <h2>{t.common.workspaces} ({workspaces.length})</h2>
          <button className="text-button" onClick={() => sendMessage({ type: 'open-dashboard' })}>
            {t.popup.viewAll}
          </button>
        </div>

        {paginatedTree.map((node) => {
          const isCollapsed = collapsedParentIds.has(node.workspace.id);

          return (
            <div key={node.workspace.id} style={{ marginBottom: '4px' }}>
              {/* Parent Workspace Row */}
              <div className="workspace-row-wrapper">
                {node.children.length > 0 && (
                  <button
                    type="button"
                    className={`tree-expand-btn ${isCollapsed ? 'collapsed' : ''}`}
                    style={{ marginLeft: '4px' }}
                    onClick={() => toggleParentCollapse(node.workspace.id)}
                    aria-label="Toggle children"
                  >
                    <Icon name="chevron-down" size={13} />
                  </button>
                )}

                <button
                  className="workspace-row"
                  disabled={busy}
                  title={t.popup.openNormalWindow.replace('{name}', node.workspace.name)}
                  onClick={() =>
                    run(async () => {
                      await sendMessage({
                        type: 'activate-workspace',
                        workspaceId: node.workspace.id,
                        incognito: false,
                      });
                      return t.popup.switchedTo.replace('{name}', node.workspace.name);
                    })
                  }
                >
                  <span className={`workspace-color ${node.workspace.color}`} />
                  <span className="workspace-row-copy">
                    <strong>
                      {node.children.length > 0 ? `📁 ${node.workspace.name}` : node.workspace.name}
                    </strong>
                    <small>
                      {node.workspace.tabs.length} {t.common.directTabs}
                      {node.children.length > 0 && ` (${t.common.totalTabs.replace('{count}', String(node.totalTabsCount))})`} ·{' '}
                      {node.workspace.live.status === 'connected'
                        ? node.workspace.live.isIncognito
                          ? t.popup.liveIncognitoSmall
                          : t.popup.liveNow
                        : t.popup.windowClosedSmall}
                    </small>
                  </span>
                </button>

                <div className="row-actions">
                  <button
                    className="row-action-btn"
                    disabled={busy}
                    title={t.dashboard.createChildWorkspaceTitle}
                    aria-label={t.dashboard.createChildWorkspaceBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedParentForChild(node.workspace);
                      setShowCreateChildModal(true);
                    }}
                  >
                    <Icon name="layers" size={13} />
                  </button>
                  <button
                    className="row-action-btn"
                    disabled={busy || linked?.id === node.workspace.id || !context?.webTabCount}
                    title={t.popup.addTabsFromThisWindow.replace('{name}', node.workspace.name)}
                    aria-label={t.popup.addTabsFromThisWindow.replace('{name}', node.workspace.name)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setTargetWsForSend(node.workspace.id);
                      setShowSendTabsModal(true);
                    }}
                  >
                    <Icon name="plus" size={13} />
                  </button>
                  <button
                    className="row-action-btn"
                    disabled={busy}
                    title={t.popup.openIncognitoWindow}
                    aria-label={t.popup.openIncognitoWindow}
                    onClick={(e) => {
                      e.stopPropagation();
                      run(async () => {
                        await sendMessage({
                          type: 'activate-workspace',
                          workspaceId: node.workspace.id,
                          incognito: true,
                        });
                        return t.popup.openedInIncognito.replace('{name}', node.workspace.name);
                      });
                    }}
                  >
                    <Icon name="incognito" size={14} />
                  </button>
                </div>
              </div>

              {/* Children Rows in Popup */}
              {node.children.length > 0 && !isCollapsed && (
                <div style={{ marginLeft: '16px', paddingLeft: '8px', borderLeft: '1px dashed var(--border-strong)' }}>
                  {node.children.map((child) => (
                    <div className="workspace-row-wrapper" key={child.id}>
                      <button
                        className="workspace-row"
                        style={{ padding: '6px 4px' }}
                        disabled={busy}
                        title={`Mở “${child.name}”`}
                        onClick={() =>
                          run(async () => {
                            await sendMessage({
                              type: 'activate-workspace',
                              workspaceId: child.id,
                              incognito: false,
                            });
                            return t.popup.switchedTo.replace('{name}', child.name);
                          })
                        }
                      >
                        <span style={{ fontSize: '10px', color: 'var(--text-faint)', marginRight: '2px' }}>└─</span>
                        <span className={`workspace-color ${child.color}`} style={{ height: '22px' }} />
                        <span className="workspace-row-copy">
                          <strong style={{ fontSize: '11px' }}>{child.name}</strong>
                          <small style={{ fontSize: '9.5px' }}>{child.tabs.length} tabs</small>
                        </span>
                      </button>

                      <div className="row-actions">
                        <button
                          className="row-action-btn"
                          disabled={busy || linked?.id === child.id || !context?.webTabCount}
                          title={t.popup.addTabsFromThisWindow.replace('{name}', child.name)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setTargetWsForSend(child.id);
                            setShowSendTabsModal(true);
                          }}
                        >
                          <Icon name="plus" size={11} />
                        </button>
                        <button
                          className="row-action-btn"
                          disabled={busy}
                          title={t.popup.openIncognitoWindow}
                          onClick={(e) => {
                            e.stopPropagation();
                            run(async () => {
                              await sendMessage({
                                type: 'activate-workspace',
                                workspaceId: child.id,
                                incognito: true,
                              });
                              return t.popup.openedInIncognito.replace('{name}', child.name);
                            });
                          }}
                        >
                          <Icon name="incognito" size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {!workspaces.length && <p className="empty-copy">{t.popup.emptyWorkspaces}</p>}

        {totalPages > 1 && (
          <nav className="popup-pagination" aria-label="Workspaces page navigation">
            <span className="pagination-info">
              {t.popup.pageNav.replace('{current}', String(currentPage)).replace('{total}', String(totalPages))}
            </span>
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                disabled={currentPage <= 1 || busy}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label={t.popup.prevPage}
                title={t.popup.prevPage}
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
                aria-label={t.popup.nextPage}
                title={t.popup.nextPage}
              >
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
          </nav>
        )}
      </section>

      <footer className="popup-footer">
        <span>{t.popup.footerCount.replace('{count}', String(workspaces.length)).replace('{s}', workspaces.length === 1 ? '' : 's')}</span>
        <button
          className="popup-footer-link"
          onClick={() => sendMessage({ type: 'open-dashboard' })}
        >
          <span>{t.popup.footerDashboardLink}</span>
          <Icon name="arrow-up-right" size={13} />
        </button>
      </footer>

      {showDedupModal && linked && (
        <DeduplicateModal
          workspace={linked}
          allWorkspaces={workspaces}
          onClose={() => setShowDedupModal(false)}
          onConfirm={handleDeduplicate}
        />
      )}

      {showSendTabsModal && workspaces.length > 0 && (
        <SendTabsModal
          workspaces={workspaces}
          sourceTabs={currentWindowTabs}
          initialTargetWorkspaceId={targetWsForSend}
          onClose={() => setShowSendTabsModal(false)}
          onConfirm={handleSendTabsConfirm}
        />
      )}

      {showCreateChildModal && selectedParentForChild && (
        <CreateChildWorkspaceModal
          parentWorkspace={selectedParentForChild}
          allWorkspaces={workspaces}
          openWindowTabs={currentWindowTabs}
          onClose={() => {
            setShowCreateChildModal(false);
            setSelectedParentForChild(null);
          }}
          onConfirm={handleCreateChildConfirm}
        />
      )}
    </main>
  );
}
