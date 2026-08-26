import { useState, useMemo, useEffect } from 'react';
import type { Workspace } from '@/src/domain/workspace';
import { getDuplicateTabGroups, getTreeDuplicateTabGroups } from '@/src/domain/workspace-service';
import { Icon } from '@/src/ui/components';
import { sendMessage } from '@/src/shared/messages';
import { useI18n } from '@/src/shared/i18n';

interface DeduplicateModalProps {
  workspace: Workspace;
  allWorkspaces?: Workspace[];
  onClose: () => void;
  onConfirm: (targetUrls: string[], scope: 'local' | 'tree') => Promise<void>;
}

export function DeduplicateModal({
  workspace,
  allWorkspaces = [],
  onClose,
  onConfirm,
}: DeduplicateModalProps) {
  const { t } = useI18n();

  // Determine root parent ID if part of a tree
  const rootParentId = workspace.parentId || workspace.id;
  const rootWorkspace = allWorkspaces.find((w) => w.id === rootParentId) || workspace;
  const treeChildren = allWorkspaces.filter((w) => w.parentId === rootParentId);
  const isPartOfTree = treeChildren.length > 0 || Boolean(workspace.parentId);

  // Scope state: 'local' or 'tree'
  const [scope, setScope] = useState<'local' | 'tree'>(() => (isPartOfTree ? 'tree' : 'local'));

  // Calculate groups for local scope vs tree scope
  const localGroups = useMemo(() => getDuplicateTabGroups(workspace.tabs), [workspace.tabs]);

  const treeGroups = useMemo(() => {
    if (!isPartOfTree) return [];
    return getTreeDuplicateTabGroups(allWorkspaces, rootParentId);
  }, [isPartOfTree, allWorkspaces, rootParentId]);

  const activeGroups = useMemo(() => {
    return scope === 'tree' ? treeGroups : localGroups;
  }, [scope, treeGroups, localGroups]);

  // Selected duplicate URLs
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(
    () => new Set(activeGroups.map((g) => g.url))
  );

  // When scope changes, update selected URLs
  useEffect(() => {
    setSelectedUrls(new Set(activeGroups.map((g) => g.url)));
  }, [scope, activeGroups]);

  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, busy]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeGroups;
    return activeGroups.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        g.url.toLowerCase().includes(q) ||
        g.hostname.toLowerCase().includes(q)
    );
  }, [activeGroups, searchQuery]);

  const totalRedundantTabs = useMemo(() => {
    return activeGroups.reduce((acc, g) => acc + g.redundantCount, 0);
  }, [activeGroups]);

  const selectedRedundantTabs = useMemo(() => {
    return activeGroups
      .filter((g) => selectedUrls.has(g.url))
      .reduce((acc, g) => acc + g.redundantCount, 0);
  }, [activeGroups, selectedUrls]);

  const selectedGroupCount = useMemo(() => {
    return activeGroups.filter((g) => selectedUrls.has(g.url)).length;
  }, [activeGroups, selectedUrls]);

  const toggleUrl = (url: string) => {
    if (busy) return;
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedUrls(new Set(activeGroups.map((g) => g.url)));
  };

  const deselectAll = () => {
    setSelectedUrls(new Set());
  };

  const handleInspectTab = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    sendMessage({ type: 'open-tab', url });
  };

  const handleSubmit = async () => {
    if (selectedUrls.size === 0 || busy) return;
    setBusy(true);
    try {
      await onConfirm(Array.from(selectedUrls), scope);
      onClose();
    } catch (err) {
      console.error('Failed to deduplicate tabs:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dedup-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dedup-modal-title"
    >
      <div className="dedup-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="dedup-modal-header">
          <div className="dedup-modal-header-info">
            <div className="dedup-modal-icon">
              <Icon name="sparkles" size={18} />
            </div>
            <div>
              <h2 id="dedup-modal-title" className="dedup-modal-title">
                {scope === 'tree' ? t.deduplicateModal.titleTree : t.deduplicateModal.titleLocal}
              </h2>
              <p className="dedup-modal-subtitle">
                {scope === 'tree'
                  ? t.deduplicateModal.subtitleTree
                      .replace('{root}', rootWorkspace.name)
                      .replace('{children}', String(treeChildren.length))
                      .replace('{redundant}', String(totalRedundantTabs))
                  : t.deduplicateModal.subtitleLocal
                      .replace('{name}', workspace.name)
                      .replace('{redundant}', String(totalRedundantTabs))
                      .replace('{groups}', String(activeGroups.length))}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t.common.close}
            disabled={busy}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Scope Switcher if part of tree */}
        {isPartOfTree && (
          <div className="dedup-scope-bar">
            <span className="dedup-scope-label">{t.deduplicateModal.scopeLabel}</span>
            <div className="dedup-scope-toggle">
              <button
                type="button"
                className={`scope-toggle-btn ${scope === 'tree' ? 'active' : ''}`}
                onClick={() => setScope('tree')}
                disabled={busy}
              >
                <Icon name="layers" size={13} />
                <span>{t.deduplicateModal.scopeTreeBtn.replace('{count}', String(treeChildren.length + 1))}</span>
              </button>
              <button
                type="button"
                className={`scope-toggle-btn ${scope === 'local' ? 'active' : ''}`}
                onClick={() => setScope('local')}
                disabled={busy}
              >
                <Icon name="layout" size={13} />
                <span>{t.deduplicateModal.scopeLocalBtn.replace('{name}', workspace.name)}</span>
              </button>
            </div>
          </div>
        )}

        {/* Toolbar: Search & Quick Actions */}
        <div className="dedup-modal-toolbar">
          <div className="dedup-search-box">
            <Icon name="search" size={14} />
            <input
              type="text"
              placeholder={t.deduplicateModal.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={busy}
            />
            {searchQuery && (
              <button
                type="button"
                className="dedup-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label={t.deduplicateModal.clearSearch}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>

          <div className="dedup-quick-actions">
            <button
              type="button"
              className="ghost-button compact"
              onClick={selectAll}
              disabled={busy || selectedUrls.size === activeGroups.length}
              title={t.deduplicateModal.selectAllTitle}
            >
              <Icon name="check-square" size={13} />
              <span>{t.deduplicateModal.selectAll}</span>
            </button>
            <button
              type="button"
              className="ghost-button compact"
              onClick={deselectAll}
              disabled={busy || selectedUrls.size === 0}
              title={t.deduplicateModal.deselectAllTitle}
            >
              <Icon name="square" size={13} />
              <span>{t.deduplicateModal.deselectAll}</span>
            </button>
          </div>
        </div>

        {/* Groups List */}
        <div className="dedup-modal-body">
          {filteredGroups.length === 0 ? (
            <div className="dedup-empty-state">
              <Icon name="alert-circle" size={24} />
              <p>
                {searchQuery
                  ? t.deduplicateModal.emptyNoMatch.replace('{query}', searchQuery)
                  : t.deduplicateModal.emptyClean}
              </p>
            </div>
          ) : (
            <div className="dedup-groups-list">
              {filteredGroups.map((group) => {
                const isChecked = selectedUrls.has(group.url);
                const occurrences = (group as any).occurrences as
                  | Array<{ workspaceId: string; workspaceName: string; isParent: boolean }>
                  | undefined;

                const tabCountNum = (group as any).totalCount || (group as any).count;

                return (
                  <div
                    key={group.url}
                    className={`dedup-group-item ${isChecked ? 'is-selected' : ''}`}
                    onClick={() => toggleUrl(group.url)}
                    role="checkbox"
                    aria-checked={isChecked}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        toggleUrl(group.url);
                      }
                    }}
                  >
                    <div className="dedup-checkbox-col">
                      <span className={`dedup-checkbox ${isChecked ? 'checked' : ''}`}>
                        {isChecked && <Icon name="check" size={12} />}
                      </span>
                    </div>

                    <div className="dedup-favicon-col">
                      <div className="favicon">
                        {group.faviconUrl ? (
                          <img src={group.faviconUrl} alt="" />
                        ) : (
                          group.hostname[0]?.toUpperCase() || 'W'
                        )}
                      </div>
                    </div>

                    <div className="dedup-content-col">
                      <div className="dedup-title-row">
                        <h4 className="dedup-title" title={group.title}>
                          {group.title}
                        </h4>
                        <span
                          className="dedup-count-pill"
                          title={t.deduplicateModal.tabCountBadge.replace('{count}', String(tabCountNum))}
                        >
                          <Icon name="layers" size={11} />
                          <span>{tabCountNum} tabs</span>
                        </span>
                      </div>

                      <div className="dedup-url-row">
                        <span className="dedup-url" title={group.url}>
                          {group.hostname}
                          <span className="dedup-dot">·</span>
                          {group.url}
                        </span>
                        <button
                          type="button"
                          className="dedup-inspect-btn"
                          onClick={(e) => handleInspectTab(e, group.url)}
                          title={t.deduplicateModal.inspectTabTitle}
                          aria-label={`${t.deduplicateModal.inspectTab} ${group.title}`}
                        >
                          <Icon name="arrow-up-right" size={12} />
                          <span>{t.deduplicateModal.inspectTab}</span>
                        </button>
                      </div>

                      {/* Tree occurrences location badges */}
                      {occurrences && occurrences.length > 0 && (
                        <div className="dedup-locations-row">
                          <span className="location-label">{t.deduplicateModal.locationLabel}</span>
                          {occurrences.map((occ, idx) => (
                            <span
                              key={idx}
                              className={`dedup-location-badge ${occ.isParent ? 'is-parent' : 'is-child'}`}
                              title={occ.workspaceName}
                            >
                              {occ.isParent
                                ? t.deduplicateModal.locationParent.replace('{name}', occ.workspaceName)
                                : t.deduplicateModal.locationChild.replace('{name}', occ.workspaceName)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="dedup-status-col">
                      {isChecked ? (
                        <span className="dedup-status-tag will-clean" title={t.deduplicateModal.willCleanTitle}>
                          {t.deduplicateModal.willCleanTag.replace('{count}', String(group.redundantCount))}
                        </span>
                      ) : (
                        <span className="dedup-status-tag will-keep" title={t.deduplicateModal.willKeepTitle}>
                          {t.deduplicateModal.willKeepTag.replace('{count}', String(tabCountNum))}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="dedup-modal-footer">
          <div className="dedup-footer-summary">
            <span>
              {t.deduplicateModal.selectedSummary
                .replace('{selected}', String(selectedGroupCount))
                .replace('{total}', String(activeGroups.length))}
            </span>
            <span className="dedup-dot">·</span>
            <span>
              {t.deduplicateModal.freeUpSummary.replace('{count}', String(selectedRedundantTabs))}
            </span>
          </div>

          <div className="dedup-footer-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={onClose}
              disabled={busy}
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              className="primary-button compact"
              onClick={handleSubmit}
              disabled={busy || selectedGroupCount === 0}
            >
              <Icon name="sparkles" size={14} />
              <span>
                {busy
                  ? t.deduplicateModal.submittingBtn
                  : t.deduplicateModal.submitBtn.replace('{count}', String(selectedRedundantTabs))}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
