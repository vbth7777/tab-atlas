import { useEffect, useMemo, useRef, useState } from 'react';
import { isConnected, type Workspace, type WorkspaceColor, type SavedTab, type WorkspaceHistoryEntry } from '@/src/domain/workspace';
import {
  getDuplicateTabGroups,
  buildWorkspaceTree,
  getAllTabsInTree,
  type TreeTabItem,
} from '@/src/domain/workspace-service';
import { sendMessage } from '@/src/shared/messages';
import { ColorPicker, Icon, WorkspaceBadge, LanguageSwitcher } from '@/src/ui/components';
import { DeduplicateModal } from '@/src/ui/deduplicate-modal';
import { SplitWorkspaceModal } from '@/src/ui/split-workspace-modal';
import { MoveTabsModal } from '@/src/ui/move-tabs-modal';
import { CreateChildWorkspaceModal } from '@/src/ui/create-child-workspace-modal';
import { AddTabModal } from '@/src/ui/add-tab-modal';
import type { SourceTabItem } from '@/src/ui/send-tabs-modal';
import { useWorkspaceStoreVersion } from '@/src/ui/use-workspace-store-version';
import { useI18n, formatSyncedLabel, formatHistoryTime } from '@/src/shared/i18n';
import '@/src/ui/app.css';

export default function Dashboard() {
  const { lang, setLanguage, t } = useI18n();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState<'local' | 'tree'>('local');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<WorkspaceColor>('indigo');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [openWindowTabs, setOpenWindowTabs] = useState<SourceTabItem[]>([]);

  // Tree collapsed parents state
  const [collapsedParentIds, setCollapsedParentIds] = useState<Set<string>>(new Set());

  // Multi-select tabs state
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(new Set());

  // Drag and Drop state
  const [draggingTabIds, setDraggingTabIds] = useState<string[]>([]);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Modals state
  const [showDedupModal, setShowDedupModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showCreateChildModal, setShowCreateChildModal] = useState(false);
  const [showAddTabModal, setShowAddTabModal] = useState(false);

  // History sub-view state
  const [viewMode, setViewMode] = useState<'tabs' | 'history'>('tabs');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'closed' | 'window_closed' | 'visited'>('all');
  const [historySearch, setHistorySearch] = useState('');


  const fileInputRef = useRef<HTMLInputElement>(null);
  const storeVersion = useWorkspaceStoreVersion();

  const loadAll = async () => {
    try {
      const [listRes, currentTabs] = await Promise.all([
        sendMessage({ type: 'list-workspaces' }),
        browser.tabs.query({ currentWindow: true }).catch(() => []),
      ]);
      setWorkspaces(listRes.workspaces);
      setSelectedId((current) =>
        current && listRes.workspaces.some((item) => item.id === current) ? current : listRes.workspaces[0]?.id ?? null,
      );
      
      setOpenWindowTabs(
        currentTabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          pendingUrl: (t as any).pendingUrl,
          favIconUrl: t.favIconUrl,
        }))
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

  // Selected workspace and tree relationships
  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? null;
  const rootParentId = selected?.parentId || selected?.id;
  const rootWorkspace = workspaces.find((w) => w.id === rootParentId) || selected;
  const childWorkspaces = useMemo(() => {
    if (!rootParentId) return [];
    return workspaces.filter((w) => w.parentId === rootParentId);
  }, [workspaces, rootParentId]);
  const isPartOfTree = childWorkspaces.length > 0 || Boolean(selected?.parentId);

  // Build full workspace tree for sidebar & structure
  const workspaceTree = useMemo(() => buildWorkspaceTree(workspaces), [workspaces]);

  // Two-tier tabs list
  const activeTabsList: Array<TreeTabItem | SavedTab> = useMemo(() => {
    if (!selected) return [];
    if (searchScope === 'tree' && isPartOfTree && rootParentId) {
      const allTreeTabs = getAllTabsInTree(workspaces, rootParentId);
      if (!query.trim()) return allTreeTabs;
      const q = query.trim().toLowerCase();
      return allTreeTabs.filter(
        (tabItem) =>
          tabItem.title.toLowerCase().includes(q) ||
          tabItem.url.toLowerCase().includes(q) ||
          tabItem.hostname.toLowerCase().includes(q) ||
          tabItem.workspaceName.toLowerCase().includes(q)
      );
    }

    if (!query.trim()) return selected.tabs;
    const q = query.trim().toLowerCase();
    return selected.tabs.filter(
      (tabItem) =>
        tabItem.title.toLowerCase().includes(q) ||
        tabItem.url.toLowerCase().includes(q) ||
        tabItem.hostname.toLowerCase().includes(q)
    );
  }, [selected, searchScope, isPartOfTree, rootParentId, workspaces, query]);

  // Reset tab selection when workspace changes
  useEffect(() => {
    setSelectedTabIds(new Set());
    setSearchScope('local');
  }, [selectedId]);

  const duplicateGroups = useMemo(() => {
    return selected ? getDuplicateTabGroups(selected.tabs) : [];
  }, [selected]);

  const totalDuplicateTabs = useMemo(() => {
    return duplicateGroups.reduce((acc, g) => acc + g.redundantCount, 0);
  }, [duplicateGroups]);

  const duplicateUrlCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of duplicateGroups) {
      map.set(g.url, g.count);
    }
    return map;
  }, [duplicateGroups]);

  const select = (workspace: Workspace) => {
    setSelectedId(workspace.id);
    setEditing(false);
    setName(workspace.name);
    setColor(workspace.color);
    setViewMode('tabs');
    setShowDedupModal(false);
    setShowCreateChildModal(false);
    setShowAddTabModal(false);
  };

  const toggleParentCollapse = (e: React.MouseEvent, parentId: string) => {
    e.stopPropagation();
    setCollapsedParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
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

  // Drag & Drop Handlers
  const handleDragStart = (tabId: string, e: React.DragEvent) => {
    const idsToDrag = selectedTabIds.has(tabId) ? Array.from(selectedTabIds) : [tabId];
    setDraggingTabIds(idsToDrag);
    e.dataTransfer.setData('text/plain', JSON.stringify(idsToDrag));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggingTabIds([]);
    setDropTargetId(null);
  };

  const handleDragOverWs = (e: React.DragEvent, targetWsId: string) => {
    if (selected && targetWsId === selected.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== targetWsId) {
      setDropTargetId(targetWsId);
    }
  };

  const handleDropOnWorkspace = async (targetWsId: string) => {
    setDropTargetId(null);
    if (!selected || targetWsId === selected.id || draggingTabIds.length === 0) return;

    const idsToMove = [...draggingTabIds];
    setDraggingTabIds([]);
    setSelectedTabIds(new Set());

    const targetWs = workspaces.find((w) => w.id === targetWsId);
    return run(async () => {
      const res = await sendMessage({
        type: 'move-tabs-between-workspaces',
        sourceWorkspaceId: selected.id,
        targetWorkspaceId: targetWsId,
        tabIds: idsToMove,
      });
      return t.popup.addedTabsSuccess
        .replace('{action}', t.popup.actionMoved)
        .replace('{count}', String(res.movedCount))
        .replace('{target}', targetWs?.name || t.common.workspace);
    });
  };

  // Multi-Select Handlers
  const toggleSelectTab = (tabId: string) => {
    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId);
      else next.add(tabId);
      return next;
    });
  };

  const selectAllCurrentTabs = () => {
    if (selectedTabIds.size === activeTabsList.length) {
      setSelectedTabIds(new Set());
    } else {
      setSelectedTabIds(new Set(activeTabsList.map((tabItem) => tabItem.id)));
    }
  };

  const handleBulkDeleteTabs = () => {
    if (!selected || selectedTabIds.size === 0) return;
    if (!confirm(t.dashboard.confirmDeleteTabs.replace('{count}', String(selectedTabIds.size)))) return;

    const remainingTabs = selected.tabs.filter((tabItem) => !selectedTabIds.has(tabItem.id));
    const count = selectedTabIds.size;
    setSelectedTabIds(new Set());

    return run(async () => {
      await sendMessage({
        type: 'update-workspace',
        workspaceId: selected.id,
        name: selected.name,
        color: selected.color,
      });
      // Update store directly via repo
      const updatedWs = { ...selected, tabs: remainingTabs, updatedAt: new Date().toISOString() };
      const currentList = workspaces.map((w) => (w.id === selected.id ? updatedWs : w));
      await sendMessage({
        type: 'import-workspaces',
        jsonText: JSON.stringify({ schemaVersion: 2, workspaces: currentList, windowToWorkspace: {} }),
      });
      return t.dashboard.deletedTabsSuccess.replace('{count}', String(count));
    });
  };

  // Split Workspace Handler
  const handleSplitWorkspace = async (params: {
    splitMode: 'by_tab_count' | 'by_child_count';
    value: number;
    childNamePrefix?: string;
    moveTabs?: boolean;
  }) => {
    if (!selected) return;
    return run(async () => {
      const res = await sendMessage({
        type: 'split-workspace',
        parentWorkspaceId: selected.id,
        splitMode: params.splitMode,
        value: params.value,
        childNamePrefix: params.childNamePrefix,
        moveTabs: params.moveTabs,
      });
      return `“${selected.name}” ➔ ${res.children.length} ${t.common.subWorkspacesCount.replace('{count}', String(res.children.length))}`;
    });
  };

  // Merge Children to Parent Handler
  const handleMergeChildren = () => {
    if (!rootWorkspace) return;
    if (
      !confirm(
        t.dashboard.confirmMergeChildren
          .replace('{count}', String(childWorkspaces.length))
          .replace('{name}', rootWorkspace.name)
      )
    )
      return;

    return run(async () => {
      const res = await sendMessage({
        type: 'merge-children-to-parent',
        parentWorkspaceId: rootWorkspace.id,
        deleteChildren: true,
      });
      return `Merged ${res.mergedTabsCount} tabs from ${res.affectedChildrenCount} children to “${rootWorkspace.name}”.`;
    });
  };

  // Create custom child workspace handler
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
      setSelectedId(res.workspace.id);
      return t.dashboard.createdChildSuccess.replace('{name}', res.workspace.name);
    });
  };

  // Add tabs to selected workspace handler
  const handleAddTabConfirm = async (params: {
    tabs: Array<{ id?: number; url: string; title?: string; faviconUrl?: string }>;
    closeSourceTabIds?: number[];
    removeFromSourceWsId?: string;
    sourceTabIds?: string[];
  }) => {
    if (!selected) return;
    return run(async () => {
      if (params.removeFromSourceWsId && params.sourceTabIds && params.sourceTabIds.length > 0) {
        const res = await sendMessage({
          type: 'move-tabs-between-workspaces',
          sourceWorkspaceId: params.removeFromSourceWsId,
          targetWorkspaceId: selected.id,
          tabIds: params.sourceTabIds,
        });
        return t.popup.addedTabsSuccess
          .replace('{action}', t.popup.actionMoved)
          .replace('{count}', String(res.movedCount))
          .replace('{target}', selected.name);
      } else {
        const res = await sendMessage({
          type: 'add-tabs-to-workspace',
          workspaceId: selected.id,
          tabs: params.tabs,
          closeSourceTabIds: params.closeSourceTabIds,
        });
        return t.popup.addedTabsSuccess
          .replace('{action}', params.closeSourceTabIds ? t.popup.actionMoved : t.popup.actionAdded)
          .replace('{count}', String(res.addedCount))
          .replace('{target}', selected.name);
      }
    });
  };

  // Deduplicate Handler (Supporting Tree Scope vs Local Scope)
  const handleDeduplicate = async (targetUrls: string[], scope: 'local' | 'tree') => {
    if (!selected) return;
    return run(async () => {
      if (scope === 'tree' && rootParentId) {
        const res = await sendMessage({
          type: 'deduplicate-tree',
          rootWorkspaceId: rootParentId,
          targetUrls,
        });
        return t.popup.dedupTreeSuccess.replace('{count}', String(res.totalRemovedCount));
      } else {
        const res = await sendMessage({
          type: 'deduplicate-workspace',
          workspaceId: selected.id,
          targetUrls,
        });
        return t.popup.dedupLocalSuccess.replace('{count}', String(res.removedCount));
      }
    });
  };

  // Move Tabs Modal Confirm
  const handleMoveTabsConfirm = async (targetWsId: string) => {
    if (!selected || selectedTabIds.size === 0) return;
    const idsToMove = Array.from(selectedTabIds);
    setSelectedTabIds(new Set());
    const targetWs = workspaces.find((w) => w.id === targetWsId);

    return run(async () => {
      const res = await sendMessage({
        type: 'move-tabs-between-workspaces',
        sourceWorkspaceId: selected.id,
        targetWorkspaceId: targetWsId,
        tabIds: idsToMove,
      });
      return t.popup.addedTabsSuccess
        .replace('{action}', t.popup.actionMoved)
        .replace('{count}', String(res.movedCount))
        .replace('{target}', targetWs?.name || t.common.workspace);
    });
  };

  const remove = (workspace: Workspace) => {
    if (!confirm(t.dashboard.confirmDeleteWorkspace.replace('{name}', workspace.name))) return;
    return run(async () => {
      await sendMessage({ type: 'delete-workspace', workspaceId: workspace.id });
      return t.dashboard.deletedWorkspaceSuccess;
    });
  };

  const submitMetadata = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    return run(async () => {
      await sendMessage({ type: 'update-workspace', workspaceId: selected.id, name, color });
      setEditing(false);
      return t.dashboard.updatedWorkspaceSuccess;
    });
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
    if (!confirm(t.dashboard.confirmClearHistory)) return;
    return run(async () => {
      await sendMessage({ type: 'clear-workspace-history', workspaceId: selected.id });
      return t.dashboard.clearedHistorySuccess;
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
      return t.popup.restoredSingleTab.replace('{title}', url);
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
      return t.popup.restoredTabsCount.replace('{count}', String(res.count));
    });
  };

  const handleMergeSnapshotToLive = (entry: WorkspaceHistoryEntry) => {
    if (!selected) return;
    const snapshotTabs = entry.tabsSnapshot || [];
    if (snapshotTabs.length === 0) return;

    return run(async () => {
      const res = await sendMessage({
        type: 'merge-snapshot-to-live',
        workspaceId: selected.id,
        snapshotTabs,
      });
      await loadAll();
      return t.dashboard.mergeSnapshotSuccess.replace('{count}', String(res.restoredCount));
    });
  };

  const handleResolveMassDrop = (action: 'restore_missing' | 'accept_current') => {
    if (!selected) return;
    return run(async () => {
      const res = await sendMessage({
        type: 'resolve-mass-drop',
        workspaceId: selected.id,
        action,
      });
      await loadAll();
      return action === 'restore_missing'
        ? t.dashboard.mergeSnapshotSuccess.replace('{count}', String(res.restoredCount ?? 0))
        : t.dashboard.updatedWorkspaceSuccess;
    });
  };

  return (
    <main className="dashboard-shell">
      {/* Sidebar with Tree Hierarchy Navigation & Drop Targets */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">
            <Icon name="layout" />
          </span>
          <span>{t.common.appName}</span>
          <span className="version-tag">v{browser.runtime.getManifest().version}</span>
        </div>
        <button
          className="new-capture"
          onClick={() =>
            setNotice(t.dashboard.emptyWorkspacesDesc)
          }
        >
          <Icon name="plus" />{t.dashboard.newWorkspace}
        </button>

        <div className="sidebar-label">
          <span>{t.common.workspaces.toUpperCase()}</span>
          <span>{workspaces.length} groups</span>
        </div>

        <nav className="workspace-nav">
          {workspaceTree.map((node) => {
            const isParentActive = selected?.id === node.workspace.id;
            const isCollapsed = collapsedParentIds.has(node.workspace.id);
            const isDropHover = dropTargetId === node.workspace.id;

            return (
              <div key={node.workspace.id} className="tree-parent-group">
                {/* Parent Row */}
                <div className="tree-parent-header">
                  {node.children.length > 0 ? (
                    <button
                      type="button"
                      className={`tree-expand-btn ${isCollapsed ? 'collapsed' : ''}`}
                      onClick={(e) => toggleParentCollapse(e, node.workspace.id)}
                      aria-label="Toggle children"
                    >
                      <Icon name="chevron-down" size={14} />
                    </button>
                  ) : (
                    <span style={{ width: '20px', flexShrink: 0 }} />
                  )}

                  <button
                    className={`nav-workspace ${isParentActive ? 'active' : ''} ${
                      isDropHover ? 'drop-target-hover' : ''
                    }`}
                    onClick={() => select(node.workspace)}
                    onDragOver={(e) => handleDragOverWs(e, node.workspace.id)}
                    onDragLeave={() => dropTargetId === node.workspace.id && setDropTargetId(null)}
                    onDrop={() => handleDropOnWorkspace(node.workspace.id)}
                    title={`${node.workspace.name} (${node.workspace.tabs.length} ${t.common.directTabs}, ${t.common.totalTabs.replace('{count}', String(node.totalTabsCount))})`}
                  >
                    <span className={`workspace-color ${node.workspace.color}`} />
                    <span className="nav-workspace-name">
                      {node.children.length > 0 ? `📁 ${node.workspace.name}` : node.workspace.name}
                    </span>
                    {node.children.length > 0 && (
                      <span className="tree-child-count-pill" title={t.common.subWorkspacesCount.replace('{count}', String(node.children.length))}>
                        {t.common.childrenCount.replace('{count}', String(node.children.length))}
                      </span>
                    )}
                    {node.workspace.live.status === 'connected' && (
                      <span
                        className="incognito-indicator"
                        title={node.workspace.live.isIncognito ? 'Live in Incognito' : 'Live window'}
                        style={{ color: node.workspace.live.isIncognito ? '#a78bfa' : '#34d399' }}
                      >
                        <Icon name={node.workspace.live.isIncognito ? 'incognito' : 'layout'} size={12} />
                      </span>
                    )}
                    <small>{node.workspace.tabs.length}</small>
                  </button>
                </div>

                {/* Children Rows */}
                {node.children.length > 0 && !isCollapsed && (
                  <div className="tree-children-container">
                    {node.children.map((child) => {
                      const isChildActive = selected?.id === child.id;
                      const isChildDropHover = dropTargetId === child.id;

                      return (
                        <button
                          key={child.id}
                          className={`nav-workspace is-child ${isChildActive ? 'active' : ''} ${
                            isChildDropHover ? 'drop-target-hover' : ''
                          }`}
                          onClick={() => select(child)}
                          onDragOver={(e) => handleDragOverWs(e, child.id)}
                          onDragLeave={() => dropTargetId === child.id && setDropTargetId(null)}
                          onDrop={() => handleDropOnWorkspace(child.id)}
                          title={`${child.name} (${child.tabs.length} tabs)`}
                        >
                          <span className="tree-child-indicator">└─</span>
                          <span className={`workspace-color ${child.color}`} />
                          <span className="nav-workspace-name">{child.name}</span>
                          {child.live.status === 'connected' && (
                            <span
                              className="incognito-indicator"
                              title={child.live.isIncognito ? 'Live in Incognito' : 'Live window'}
                              style={{ color: child.live.isIncognito ? '#a78bfa' : '#34d399' }}
                            >
                              <Icon name={child.live.isIncognito ? 'incognito' : 'layout'} size={12} />
                            </span>
                          )}
                          <small>{child.tabs.length}</small>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {!workspaces.length && !loading && <p className="empty-copy">{t.dashboard.emptyWorkspacesYet}</p>}

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="privacy-dot" style={{ background: '#34d399' }} />
            <span>{t.common.offlineLocal}</span>
          </div>
        </div>
      </aside>

      {/* Main Dashboard Content */}
      <section className="dashboard-content">
        {/* Top Settings Bar */}
        <div className="top-settings-bar">
          <div className="settings-status-group">
            <span className="privacy-dot" style={{ background: '#34d399' }} />
            <span className="settings-status-text">
              <strong>{t.common.offlineLocal}</strong>
            </span>
          </div>

          <div className="settings-actions-group">
            <LanguageSwitcher lang={lang} onLanguageChange={setLanguage} variant="pill" />
            <button className="ghost-button compact" onClick={exportJson} title={t.dashboard.exportJsonTitle}>
              <span>{t.dashboard.exportJson}</span>
            </button>
            <button
              className="ghost-button compact"
              onClick={() => fileInputRef.current?.click()}
              title={t.dashboard.importJsonTitle}
            >
              <span>{t.dashboard.importJson}</span>
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

        {/* Dashboard Header with Two-Tier Search Scope Bar */}
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">{t.dashboard.taglineEyebrow}</p>
            <h1>{t.dashboard.taglineTitle}</h1>
          </div>
          <div className="search-scope-container">
            <label className="search-field">
              <Icon name="search" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  searchScope === 'tree' && isPartOfTree
                    ? t.dashboard.searchPlaceholderTree.replace('{name}', rootWorkspace?.name || '')
                    : t.dashboard.searchPlaceholderLocal.replace('{name}', selected?.name || t.common.workspace)
                }
              />
              {query && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setQuery('')}
                  style={{ padding: '2px', color: 'var(--text-faint)' }}
                >
                  <Icon name="x" size={13} />
                </button>
              )}
            </label>

            {isPartOfTree && (
              <div className="search-scope-toggle">
                <button
                  type="button"
                  className={`scope-btn ${searchScope === 'local' ? 'active' : ''}`}
                  onClick={() => setSearchScope('local')}
                  title="Search only in this workspace"
                >
                  <Icon name="layout" size={12} />
                  <span>{t.dashboard.searchScopeLocal}</span>
                </button>
                <button
                  type="button"
                  className={`scope-btn ${searchScope === 'tree' ? 'active' : ''}`}
                  onClick={() => setSearchScope('tree')}
                  title="Search in entire tree"
                >
                  <Icon name="layers" size={12} />
                  <span>{t.dashboard.searchScopeTree.replace('{count}', String(childWorkspaces.length + 1))}</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {notice && (
          <p className="notice" role="status">
            {notice}
            <button onClick={() => setNotice('')} aria-label={t.common.close}>
              <Icon name="x" size={16} />
            </button>
          </p>
        )}

        {loading ? (
          <p className="empty-copy">{t.common.loading}</p>
        ) : !selected ? (
          <section className="dashboard-empty">
            <span className="empty-icon">
              <Icon name="archive" size={28} />
            </span>
            <h2>{t.dashboard.emptyWorkspacesYet}</h2>
            <p>{t.dashboard.emptyWorkspacesDesc}</p>
          </section>
        ) : (
          <section className="workspace-detail">
            {/* Detail Toolbar */}
            <div className="detail-toolbar">
              <div>
                {editing ? (
                  <form className="inline-edit" onSubmit={submitMetadata}>
                    <input
                      autoFocus
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      aria-label="Workspace name"
                    />
                    <ColorPicker value={color} onChange={setColor} />
                    <button className="primary-button compact" type="submit">
                      {t.common.save}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => setEditing(false)}>
                      {t.common.cancel}
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="detail-title">
                      <span className={`large-color ${selected.color}`} />
                      <h2>{selected.name}</h2>
                      {selected.parentId && (
                        <span className="tree-child-count-pill" style={{ color: '#38bdf8' }}>
                          {t.dashboard.childOf.replace('{parent}', rootWorkspace?.name || '')}
                        </span>
                      )}
                      <WorkspaceBadge workspace={selected} lang={lang} />
                      <button
                        className="tiny-button"
                        onClick={() => {
                          setName(selected.name);
                          setColor(selected.color);
                          setEditing(true);
                        }}
                      >
                        {t.common.edit}
                      </button>
                    </div>
                    <p>
                      {selected.tabs.length} {t.common.directTabs}
                      {childWorkspaces.length > 0 && ` · ${t.common.subWorkspacesCount.replace('{count}', String(childWorkspaces.length))}`} · {formatSyncedLabel(selected, lang)}
                    </p>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="detail-actions">
                {/* Create Custom Child Workspace Button (For Parent Workspaces) */}
                {!selected.parentId && (
                  <button
                    className="ghost-button compact"
                    style={{ borderColor: '#38bdf8', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.08)' }}
                    onClick={() => setShowCreateChildModal(true)}
                    title={t.dashboard.createChildWorkspaceTitle}
                  >
                    <Icon name="plus" size={14} />
                    <span>{t.dashboard.createChildWorkspaceBtn}</span>
                  </button>
                )}

                {/* Split / Chia Đều Tab Button (Only for Root Workspaces) */}
                {!selected.parentId && (
                  <button
                    className="ghost-button compact"
                    onClick={() => setShowSplitModal(true)}
                    disabled={selected.tabs.length < 2}
                    title={selected.tabs.length < 2 ? t.dashboard.splitDisabledHint : t.dashboard.splitWorkspaceTitle}
                  >
                    <Icon name="split" size={14} />
                    <span>{t.dashboard.splitWorkspaceBtn}</span>
                  </button>
                )}

                {/* Deduplicate Button */}
                {(totalDuplicateTabs > 0 || isPartOfTree) && (
                  <button
                    className="ghost-button compact"
                    style={{ borderColor: '#d97706', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.12)' }}
                    onClick={() => setShowDedupModal(true)}
                    title={t.dashboard.dedupWorkspaceTitle.replace('{count}', String(duplicateGroups.length))}
                  >
                    <Icon name="sparkles" size={14} />
                    <span>{t.dashboard.dedupWorkspaceBtn}</span>
                    {totalDuplicateTabs > 0 && <span className="dedup-trigger-badge">{totalDuplicateTabs}</span>}
                  </button>
                )}

                <button className="ghost-button" onClick={() => remove(selected)}>
                  <Icon name="trash" />{t.dashboard.deleteWorkspace}
                </button>

                {isConnected(selected) && (
                  <button
                    className="ghost-button"
                    onClick={() =>
                      run(async () => {
                        const response = await sendMessage({
                          type: 'detach-workspace',
                          workspaceId: selected.id,
                        });
                        return t.popup.noLongerTracks.replace('{name}', response.workspace.name);
                      })
                    }
                  >
                    <Icon name="unlink" />{t.dashboard.detachWorkspace}
                  </button>
                )}

                <button
                  className="primary-button compact"
                  onClick={() =>
                    run(async () => {
                      const res = await sendMessage({
                        type: 'activate-workspace',
                        workspaceId: selected.id,
                        incognito: false,
                      });
                      return isConnected(res.workspace) && !res.workspace.live.isIncognito
                        ? t.popup.switchedTo.replace('{name}', res.workspace.name)
                        : `Opened “${res.workspace.name}” in a normal window.`;
                    })
                  }
                >
                  <Icon name={isConnected(selected) && !selected.live.isIncognito ? 'arrow-up-right' : 'copy'} />
                  {isConnected(selected) && !selected.live.isIncognito ? t.dashboard.switchToWindow : t.dashboard.openWorkspace}
                </button>

                <button
                  className="ghost-button compact incognito-button"
                  onClick={() =>
                    run(async () => {
                      const res = await sendMessage({
                        type: 'activate-workspace',
                        workspaceId: selected.id,
                        incognito: true,
                      });
                      return isConnected(res.workspace) && res.workspace.live.isIncognito
                        ? t.popup.switchedTo.replace('{name}', res.workspace.name)
                        : t.popup.openedInIncognito.replace('{name}', res.workspace.name);
                    })
                  }
                  title="Open workspace in an Incognito window"
                >
                  <Icon name="incognito" size={15} />
                  {isConnected(selected) && selected.live.isIncognito ? t.dashboard.switchToIncognito : t.dashboard.openInIncognito}
                </button>
              </div>
            </div>

            {/* Sub-Workspaces Overview Cards (For Parent Workspaces) */}
            {childWorkspaces.length > 0 && !selected.parentId && (
              <div className="sub-workspaces-section">
                <div className="sub-workspaces-header">
                  <h3>
                    <Icon name="layers" size={16} />
                    <span>{t.dashboard.subWorkspacesTitle.replace('{count}', String(childWorkspaces.length))}</span>
                  </h3>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={() => setShowCreateChildModal(true)}
                      title={t.dashboard.addChildTitle}
                    >
                      <Icon name="plus" size={13} />
                      <span>{t.dashboard.addChildBtn}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={() => setShowSplitModal(true)}
                      disabled={selected.tabs.length < 2}
                      title={selected.tabs.length < 2 ? t.dashboard.splitDisabledHint : t.dashboard.splitWorkspaceTitle}
                    >
                      <Icon name="split" size={13} />
                      <span>{t.dashboard.splitWorkspaceBtn}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={handleMergeChildren}
                      title={t.dashboard.mergeChildrenTitle}
                    >
                      <Icon name="git-merge" size={13} />
                      <span>{t.dashboard.mergeChildrenBtn}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={() =>
                        run(async () => {
                          const res = await sendMessage({
                            type: 'activate-tree',
                            parentWorkspaceId: selected.id,
                          });
                          return t.dashboard.openedTreeWindows
                            .replace('{count}', String(res.openedCount))
                            .replace('{name}', selected.name);
                        })
                      }
                      title={t.dashboard.openEntireTreeTitle}
                    >
                      <Icon name="arrow-up-right" size={13} />
                      <span>{t.dashboard.openEntireTreeBtn}</span>
                    </button>
                  </div>
                </div>

                <div className="sub-workspaces-grid">
                  {childWorkspaces.map((child) => (
                    <div
                      key={child.id}
                      className="sub-ws-card"
                      onClick={() => select(child)}
                      onDragOver={(e) => handleDragOverWs(e, child.id)}
                      onDragLeave={() => dropTargetId === child.id && setDropTargetId(null)}
                      onDrop={() => handleDropOnWorkspace(child.id)}
                    >
                      <div className="sub-ws-card-header">
                        <span className={`workspace-color ${child.color}`} style={{ width: '8px', height: '22px' }} />
                        <span className="sub-ws-card-title">{child.name}</span>
                      </div>
                      <div className="sub-ws-card-body">
                        <span>{t.dashboard.tabsSavedCount.replace('{count}', String(child.tabs.length))}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>
                          {child.tabs.slice(0, 2).map((tabItem) => tabItem.title).join(' · ') || t.dashboard.noTabsYet}
                        </span>
                      </div>
                      <div className="sub-ws-card-footer">
                        <WorkspaceBadge workspace={child} lang={lang} />
                        <span>{t.dashboard.dragDropHint}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mass Drop Protection Alert Banner */}
            {selected.live.syncLocked && selected.live.massDropWarning && (
              <div className="mass-drop-alert-banner">
                <div className="mass-drop-alert-content">
                  <div className="mass-drop-alert-icon">
                    <Icon name="alert-circle" size={18} />
                  </div>
                  <div>
                    <div className="mass-drop-alert-title">
                      {t.dashboard.massDropAlertTitle.replace('{count}', String(selected.live.massDropWarning.droppedCount))}
                    </div>
                    <div className="mass-drop-alert-subtitle">
                      {`Cửa sổ sụt giảm từ ${selected.live.massDropWarning.previousCount} xuống còn ${selected.live.massDropWarning.currentCount} tab.`}
                    </div>
                  </div>
                </div>
                <div className="mass-drop-alert-actions">
                  <button
                    type="button"
                    className="primary-button compact"
                    onClick={() => handleResolveMassDrop('restore_missing')}
                  >
                    <Icon name="rotate-ccw" size={13} />
                    <span>{t.dashboard.restoreMissingTabs.replace('{count}', String(selected.live.massDropWarning.droppedCount))}</span>
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact"
                    onClick={() => handleResolveMassDrop('accept_current')}
                  >
                    <span>{t.dashboard.acceptCurrentTabs}</span>
                  </button>
                </div>
              </div>
            )}

            {/* View Switcher: Active Tabs vs History & Add Tab Action */}
            <div className="view-tabs">
              <button
                type="button"
                className={`view-tab-btn ${viewMode === 'tabs' ? 'active' : ''}`}
                onClick={() => setViewMode('tabs')}
              >
                <Icon name="layout" size={14} />
                <span>
                  {searchScope === 'tree' && isPartOfTree
                    ? t.dashboard.viewTreeTabs.replace('{count}', String(activeTabsList.length))
                    : t.dashboard.viewActiveTabs.replace('{count}', String(selected.tabs.length))}
                </span>
                <span className="view-tab-badge">{activeTabsList.length}</span>
              </button>
              <button
                type="button"
                className={`view-tab-btn ${viewMode === 'history' ? 'active' : ''}`}
                onClick={() => setViewMode('history')}
              >
                <Icon name="history" size={14} />
                <span>{t.dashboard.viewHistory}</span>
                <span className="view-tab-badge">{historyEntries.length}</span>
              </button>

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="primary-button compact"
                  style={{ background: 'linear-gradient(135deg, #059669, #10b981)', padding: '5px 11px', fontSize: '11.5px' }}
                  onClick={() => setShowAddTabModal(true)}
                  title={t.dashboard.addTabTitle}
                >
                  <Icon name="plus" size={13} />
                  <span>{t.dashboard.addTabBtn}</span>
                </button>

                {viewMode === 'tabs' && activeTabsList.length > 0 && (
                  <button
                    type="button"
                    className="ghost-button compact"
                    onClick={selectAllCurrentTabs}
                    title="Select all / Deselect all tabs"
                  >
                    <Icon name={selectedTabIds.size === activeTabsList.length ? 'check-square' : 'square'} size={13} />
                    <span>
                      {selectedTabIds.size === activeTabsList.length ? t.common.deselectAll : t.common.selectAll}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Tab List View */}
            {viewMode === 'tabs' ? (
              <div className="tab-list">
                {activeTabsList.map((tabItem) => {
                  const isSelectedTab = selectedTabIds.has(tabItem.id);
                  const dupCount = duplicateUrlCountMap.get(tabItem.url);
                  const treeTab = tabItem as TreeTabItem;

                  return (
                    <article
                      className={`saved-tab ${isSelectedTab ? 'is-selected' : ''} ${
                        draggingTabIds.includes(tabItem.id) ? 'is-dragging' : ''
                      }`}
                      key={tabItem.id}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(tabItem.id, e)}
                      onDragEnd={handleDragEnd}
                    >
                      {/* Checkbox for Multi-Select */}
                      <input
                        type="checkbox"
                        className="tab-select-checkbox"
                        checked={isSelectedTab}
                        onChange={() => toggleSelectTab(tabItem.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select tab ${tabItem.title}`}
                      />

                      {/* Drag Handle */}
                      <div className="tab-drag-handle" title={t.dashboard.dragHandleTitle}>
                        <Icon name="grip-vertical" size={14} />
                      </div>

                      {/* Favicon */}
                      <div className="favicon">
                        {tabItem.faviconUrl ? <img src={tabItem.faviconUrl} alt="" /> : tabItem.hostname[0]?.toUpperCase()}
                      </div>

                      {/* Tab Details */}
                      <div className="tab-copy">
                        <h3>
                          {treeTab.workspaceName && searchScope === 'tree' && (
                            <span className="tab-origin-tag" title={t.dashboard.belongsToWs.replace('{name}', treeTab.workspaceName)}>
                              {treeTab.isParent ? '📁 ' : '└─ '}{treeTab.workspaceName}
                            </span>
                          )}
                          <span>{tabItem.title}</span>
                          {dupCount && dupCount >= 2 && (
                            <span
                              className="tab-duplicate-pill"
                              title={t.dashboard.duplicateCountPill.replace('{count}', String(dupCount))}
                            >
                              <Icon name="layers" size={10} />
                              <span>x{dupCount}</span>
                            </span>
                          )}
                        </h3>
                        <p>
                          {tabItem.hostname}
                          <span>·</span>
                          {tabItem.url}
                        </p>
                      </div>

                      {/* Open tab button */}
                      <button
                        className="open-tab"
                        onClick={() => sendMessage({ type: 'open-tab', url: tabItem.url })}
                        aria-label={t.dashboard.openTabNewWindow.replace('{title}', tabItem.title)}
                      >
                        <Icon name="arrow-up-right" />
                      </button>
                    </article>
                  );
                })}
                {!activeTabsList.length && (
                  <p className="empty-copy">
                    {query ? t.dashboard.emptyTabsSearchMatch : t.dashboard.emptyTabsInWs}
                  </p>
                )}
              </div>
            ) : (
              /* History View */
              <div>
                <div className="history-controls">
                  <div className="filter-chips">
                    <button
                      type="button"
                      className={`filter-chip ${historyFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setHistoryFilter('all')}
                    >
                      {t.dashboard.historyFilterAll.replace('{count}', String(historyEntries.length))}
                    </button>
                    <button
                      type="button"
                      className={`filter-chip ${historyFilter === 'closed' ? 'active' : ''}`}
                      onClick={() => setHistoryFilter('closed')}
                    >
                      {t.dashboard.historyFilterClosed.replace(
                        '{count}',
                        String(historyEntries.filter((h) => h.eventType === 'closed').length)
                      )}
                    </button>
                    <button
                      type="button"
                      className={`filter-chip ${historyFilter === 'window_closed' ? 'active' : ''}`}
                      onClick={() => setHistoryFilter('window_closed')}
                    >
                      {t.dashboard.historyFilterWindowClosed.replace(
                        '{count}',
                        String(historyEntries.filter((h) => h.eventType === 'window_closed').length)
                      )}
                    </button>
                    <button
                      type="button"
                      className={`filter-chip ${historyFilter === 'visited' ? 'active' : ''}`}
                      onClick={() => setHistoryFilter('visited')}
                    >
                      {t.dashboard.historyFilterVisited.replace(
                        '{count}',
                        String(historyEntries.filter((h) => h.eventType === 'visited' || h.eventType === 'opened').length)
                      )}
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder={t.dashboard.historySearchPlaceholder}
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      style={{ padding: '4px 8px', fontSize: '11px', borderRadius: '6px', width: '150px' }}
                    />
                    {historyEntries.length > 0 && (
                      <button
                        className="text-button"
                        style={{ fontSize: '11px', color: '#fb7185' }}
                        onClick={handleClearHistory}
                      >
                        {t.dashboard.historyClearBtn}
                      </button>
                    )}
                  </div>
                </div>

                <div className="history-list">
                  {filteredHistory.map((item, idx) => {
                    const isBatchStart =
                      item.batchId && (idx === 0 || filteredHistory[idx - 1]?.batchId !== item.batchId);
                    const batchItems = item.batchId ? filteredHistory.filter((h) => h.batchId === item.batchId) : [];

                    if (item.eventType === 'window_closed') {
                      const count = item.tabCount ?? item.tabsSnapshot?.length ?? 0;
                      const sessionUrls = item.tabsSnapshot?.map((tabItem) => tabItem.url) || selected.tabs.map((tabItem) => tabItem.url);
                      return (
                        <article
                          className="history-entry"
                          key={item.id}
                          style={{
                            background: 'rgba(251, 191, 36, 0.04)',
                            borderColor: 'rgba(251, 191, 36, 0.2)',
                          }}
                        >
                          <div
                            className="favicon"
                            style={{ background: '#291e0a', borderColor: '#785a10', color: '#fbbf24' }}
                          >
                            <Icon name="layout" size={14} />
                          </div>
                          <div className="tab-copy">
                            <h3>
                              <span>{item.title}</span>
                              <span className="history-type-badge window_closed">{t.dashboard.windowSessionTitle}</span>
                              {item.isIncognito && (
                                <span
                                  className="history-type-badge closed"
                                  style={{ background: '#231942', color: '#c4b5fd', borderColor: '#5b21b6' }}
                                >
                                  Incognito
                                </span>
                              )}
                              <span className="history-time">{formatHistoryTime(item.timestamp, lang)}</span>
                            </h3>
                            <p>{t.dashboard.windowSessionDesc.replace('{count}', String(count))}</p>
                          </div>
                          <div className="history-actions">
                            <button
                              className="restore-btn"
                              style={{ borderColor: '#785a10', background: '#36280b', color: '#fde68a' }}
                              onClick={() => handleRestoreBatch(sessionUrls, item.isIncognito)}
                              title="Reopen all tabs from this closed window session"
                            >
                              <Icon name="rotate-ccw" size={12} />
                              <span>{t.dashboard.reopenWindowBtn.replace('{count}', String(count))}</span>
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
                              <Icon name="layers" size={13} /> {t.dashboard.batchClosureTitle.replace('{count}', String(batchItems.length))}
                            </span>
                            <button
                              type="button"
                              className="restore-btn"
                              onClick={() => handleRestoreBatch(batchItems.map((b) => b.url), item.isIncognito)}
                            >
                              <Icon name="rotate-ccw" size={12} />
                              <span>{t.dashboard.restoreAllBatchBtn.replace('{count}', String(batchItems.length))}</span>
                            </button>
                          </div>
                        )}
                        <article className="history-entry">
                          <div className="favicon">
                            {item.faviconUrl ? <img src={item.faviconUrl} alt="" /> : item.hostname[0]?.toUpperCase()}
                          </div>
                          <div className="tab-copy">
                            <h3>
                              <span>{item.title}</span>
                              <span className={`history-type-badge ${item.eventType}`}>{item.eventType}</span>
                              {item.isIncognito && (
                                <span
                                  className="history-type-badge closed"
                                  style={{ background: '#231942', color: '#c4b5fd', borderColor: '#5b21b6' }}
                                >
                                  Incognito
                                </span>
                              )}
                              <span className="history-time">{formatHistoryTime(item.timestamp, lang)}</span>
                            </h3>
                            <p>
                              {item.hostname}
                              <span>·</span>
                              {item.url}
                            </p>
                          </div>
                          <div className="history-actions">
                            <button
                              className="restore-btn"
                              onClick={() => handleRestoreTab(item.url, item.isIncognito)}
                              title="Reopen this tab"
                            >
                              <Icon name="rotate-ccw" size={12} />
                              <span>{t.dashboard.restoreTabBtn}</span>
                            </button>
                          </div>
                        </article>
                      </div>
                    );
                  })}
                  {!filteredHistory.length && (
                    <p className="empty-copy">{t.dashboard.historyEmpty}</p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </section>

      {/* Floating Multi-Select Action Bar */}
      {selectedTabIds.size > 0 && selected && (
        <div className="floating-select-bar" role="toolbar" aria-label="Selected tabs actions">
          <div className="select-bar-info">
            <span className="select-count-badge">{selectedTabIds.size}</span>
            <span>{t.dashboard.floatingSelected.replace('{count}', String(selectedTabIds.size))}</span>
          </div>

          <div className="select-bar-actions">
            <button
              type="button"
              className="primary-button compact"
              onClick={() => setShowMoveModal(true)}
              title={t.dashboard.floatingMoveBtn}
            >
              <Icon name="move" size={13} />
              <span>{t.dashboard.floatingMoveBtn}</span>
            </button>
            <button
              type="button"
              className="ghost-button compact"
              style={{ color: '#fb7185', borderColor: '#e11d48' }}
              onClick={handleBulkDeleteTabs}
              title={t.dashboard.floatingDeleteBtn}
            >
              <Icon name="trash" size={13} />
              <span>{t.dashboard.floatingDeleteBtn}</span>
            </button>
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => setSelectedTabIds(new Set())}
              title={t.dashboard.floatingDeselectBtn}
            >
              <Icon name="x" size={13} />
              <span>{t.dashboard.floatingDeselectBtn}</span>
            </button>
          </div>
        </div>
      )}

      {/* Deduplicate Modal (Enhanced with Two-Tier Scope) */}
      {showDedupModal && selected && (
        <DeduplicateModal
          workspace={selected}
          allWorkspaces={workspaces}
          onClose={() => setShowDedupModal(false)}
          onConfirm={handleDeduplicate}
        />
      )}

      {/* Split Workspace Modal */}
      {showSplitModal && selected && (
        <SplitWorkspaceModal
          workspace={selected}
          onClose={() => setShowSplitModal(false)}
          onConfirm={handleSplitWorkspace}
        />
      )}

      {/* Move Tabs Modal */}
      {showMoveModal && selected && selectedTabIds.size > 0 && (
        <MoveTabsModal
          currentWorkspace={selected}
          allWorkspaces={workspaces}
          selectedTabCount={selectedTabIds.size}
          onClose={() => setShowMoveModal(false)}
          onConfirm={handleMoveTabsConfirm}
        />
      )}

      {/* Custom Child Workspace Modal */}
      {showCreateChildModal && selected && (
        <CreateChildWorkspaceModal
          parentWorkspace={selected}
          allWorkspaces={workspaces}
          openWindowTabs={openWindowTabs}
          onClose={() => setShowCreateChildModal(false)}
          onOpenSplitModal={() => setShowSplitModal(true)}
          onConfirm={handleCreateChildConfirm}
        />
      )}

      {/* Add Tab to Workspace Modal */}
      {showAddTabModal && selected && (
        <AddTabModal
          targetWorkspace={selected}
          allWorkspaces={workspaces}
          openWindowTabs={openWindowTabs}
          onClose={() => setShowAddTabModal(false)}
          onConfirm={handleAddTabConfirm}
        />
      )}
    </main>
  );
}
