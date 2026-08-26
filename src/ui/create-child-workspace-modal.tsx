import { useState, useMemo, useEffect } from 'react';
import type { Workspace, WorkspaceColor, SavedTab } from '@/src/domain/workspace';
import { extractWebUrl } from '@/src/domain/workspace-service';
import { Icon, ColorPicker } from '@/src/ui/components';
import { useI18n } from '@/src/shared/i18n';
import type { SourceTabItem } from '@/src/ui/send-tabs-modal';

interface CreateChildWorkspaceModalProps {
  parentWorkspace: Workspace;
  allWorkspaces: Workspace[];
  openWindowTabs?: SourceTabItem[];
  onClose: () => void;
  onOpenSplitModal?: () => void;
  onConfirm: (params: {
    parentId: string;
    name: string;
    color: WorkspaceColor;
    initialTabs: Array<{ url: string; title?: string; faviconUrl?: string }>;
    removeTabsFromParent: boolean;
  }) => Promise<void>;
}

export function CreateChildWorkspaceModal({
  parentWorkspace,
  allWorkspaces,
  openWindowTabs = [],
  onClose,
  onOpenSplitModal,
  onConfirm,
}: CreateChildWorkspaceModalProps) {
  const { t } = useI18n();

  // Filter root/parent workspaces for parent selection
  const candidateParents = useMemo(() => {
    return allWorkspaces.filter((w) => !w.parentId);
  }, [allWorkspaces]);

  const [parentId, setParentId] = useState<string>(parentWorkspace.parentId || parentWorkspace.id);
  const selectedParent = useMemo(() => {
    return allWorkspaces.find((w) => w.id === parentId) || parentWorkspace;
  }, [allWorkspaces, parentId, parentWorkspace]);

  // Color selection: default to next palette color or parent color
  const [color, setColor] = useState<WorkspaceColor>(() => {
    const palette: WorkspaceColor[] = ['indigo', 'sky', 'teal', 'emerald', 'amber', 'orange', 'rose', 'violet'];
    const idx = palette.indexOf(parentWorkspace.color);
    return palette[(idx + 1) % palette.length] || 'teal';
  });

  const [name, setName] = useState('');
  const [tabMode, setTabMode] = useState<'empty' | 'parent' | 'window'>('empty');
  const [removeTabsFromParent, setRemoveTabsFromParent] = useState(false);
  const [tabSearch, setTabSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // Available tabs from parent workspace
  const parentTabs = useMemo(() => {
    return selectedParent.tabs;
  }, [selectedParent]);

  // Available web tabs from open window
  const validWindowTabs = useMemo(() => {
    return openWindowTabs
      .map((item) => {
        const rawUrl = item.pendingUrl || item.url;
        const webUrl = extractWebUrl(rawUrl);
        if (!webUrl) return null;
        let hostname = webUrl;
        try {
          hostname = new URL(webUrl).hostname.replace(/^www\./, '');
        } catch {}
        return {
          id: item.id,
          title: item.title || hostname,
          url: webUrl,
          faviconUrl: item.favIconUrl,
          hostname,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [openWindowTabs]);

  // Selected tab indices for parent tabs or window tabs
  const [selectedParentTabIndices, setSelectedParentTabIndices] = useState<Set<number>>(new Set());
  const [selectedWindowTabIndices, setSelectedWindowTabIndices] = useState<Set<number>>(
    () => new Set(validWindowTabs.map((_, i) => i))
  );

  // Filtered lists by tabSearch
  const filteredParentTabs = useMemo(() => {
    if (!tabSearch.trim()) return parentTabs;
    const q = tabSearch.trim().toLowerCase();
    return parentTabs.filter(
      (t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q) || t.hostname.toLowerCase().includes(q)
    );
  }, [parentTabs, tabSearch]);

  const filteredWindowTabs = useMemo(() => {
    if (!tabSearch.trim()) return validWindowTabs;
    const q = tabSearch.trim().toLowerCase();
    return validWindowTabs.filter(
      (t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q) || t.hostname.toLowerCase().includes(q)
    );
  }, [validWindowTabs, tabSearch]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, busy]);

  const toggleParentTab = (idx: number) => {
    if (busy) return;
    setSelectedParentTabIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleWindowTab = (idx: number) => {
    if (busy) return;
    setSelectedWindowTabIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAllParentTabs = () => {
    setSelectedParentTabIndices(new Set(parentTabs.map((_, idx) => idx)));
  };

  const deselectAllParentTabs = () => {
    setSelectedParentTabIndices(new Set());
  };

  const selectAllWindowTabs = () => {
    setSelectedWindowTabIndices(new Set(validWindowTabs.map((_, idx) => idx)));
  };

  const deselectAllWindowTabs = () => {
    setSelectedWindowTabIndices(new Set());
  };

  const quickSuggestions = [
    t.createChildModal.suggestionDocs,
    t.createChildModal.suggestionResearch,
    t.createChildModal.suggestionTasks,
    t.createChildModal.suggestionTemp,
    t.createChildModal.suggestionMedia,
  ];

  const handleApplySuggestion = (suggestion: string) => {
    if (!name.trim()) {
      setName(`${selectedParent.name} - ${suggestion}`);
    } else if (!name.includes(suggestion)) {
      setName(`${name} - ${suggestion}`);
    }
  };

  const selectedInitialTabs = useMemo(() => {
    if (tabMode === 'parent') {
      return parentTabs
        .filter((_, idx) => selectedParentTabIndices.has(idx))
        .map((t) => ({ url: t.url, title: t.title, faviconUrl: t.faviconUrl }));
    }
    if (tabMode === 'window') {
      return validWindowTabs
        .filter((_, idx) => selectedWindowTabIndices.has(idx))
        .map((t) => ({ url: t.url, title: t.title, faviconUrl: t.faviconUrl }));
    }
    return [];
  }, [tabMode, parentTabs, selectedParentTabIndices, validWindowTabs, selectedWindowTabIndices]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim() || `${selectedParent.name} - Con`;
    if (busy) return;

    setBusy(true);
    try {
      await onConfirm({
        parentId: selectedParent.id,
        name: cleanName,
        color,
        initialTabs: selectedInitialTabs,
        removeTabsFromParent: tabMode === 'parent' && removeTabsFromParent,
      });
      onClose();
    } catch (err) {
      console.error('Failed to create child workspace:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="send-tabs-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-child-title"
    >
      <div className="send-tabs-modal-card create-child-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="send-tabs-modal-header">
          <div className="send-tabs-modal-header-info">
            <div className="send-tabs-modal-icon" style={{ background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8' }}>
              <Icon name="layers" size={18} />
            </div>
            <div>
              <h2 id="create-child-title" className="send-tabs-modal-title">
                {t.createChildModal.title}
              </h2>
              <p className="send-tabs-modal-subtitle">
                {t.createChildModal.subtitle.replace('{parent}', selectedParent.name)}
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

        {/* Modal Scrollable Body */}
        <form onSubmit={handleSubmit} className="send-tabs-modal-body">
          {/* Direct quick access to Auto Split / Divide tabs evenly (Only for Root Workspaces) */}
          {!selectedParent.parentId && parentTabs.length >= 2 && onOpenSplitModal && (
            <div className="create-child-split-banner">
              <div className="split-banner-text">
                <strong>💡 {t.createChildModal.wantToSplitTitle}</strong>
                <span>{t.createChildModal.wantToSplitDesc.replace('{count}', String(parentTabs.length))}</span>
              </div>
              <button
                type="button"
                className="split-banner-btn"
                onClick={() => {
                  onClose();
                  onOpenSplitModal();
                }}
              >
                <Icon name="split" size={13} />
                <span>{t.createChildModal.openSplitBtn}</span>
              </button>
            </div>
          )}

          {/* Section 1: Child Workspace Name */}
          <div className="send-tabs-section">
            <label className="create-child-label">
              <strong>{t.createChildModal.nameLabel}</strong>
              <input
                type="text"
                autoFocus
                className="create-child-input"
                placeholder={t.createChildModal.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
              />
            </label>

            {/* Quick Suggestions Chips */}
            <div className="create-child-suggestions-row">
              <span className="suggestions-label">{t.createChildModal.nameSuggestionsLabel}</span>
              <div className="suggestions-chips">
                {quickSuggestions.map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => handleApplySuggestion(sug)}
                  >
                    + {sug}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 2: Color Picker & Parent Workspace */}
          <div className="create-child-row-grid">
            <div className="create-child-section-col">
              <label className="create-child-label">
                <strong>{t.createChildModal.colorLabel}</strong>
              </label>
              <div style={{ marginTop: '4px' }}>
                <ColorPicker value={color} onChange={setColor} />
              </div>
            </div>

            {candidateParents.length > 1 && (
              <div className="create-child-section-col">
                <label className="create-child-label">
                  <strong>{t.createChildModal.parentLabel}</strong>
                  <select
                    className="create-child-select"
                    value={parentId}
                    onChange={(e) => setParentId(e.target.value)}
                    disabled={busy}
                  >
                    {candidateParents.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.tabs.length} tabs)
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* Section 3: Initial Tabs Option */}
          <div className="send-tabs-section" style={{ marginTop: '16px' }}>
            <label className="create-child-label">
              <strong>{t.createChildModal.initTabsLabel}</strong>
            </label>

            <div className="create-child-mode-tabs">
              <button
                type="button"
                className={`mode-tab-btn ${tabMode === 'empty' ? 'active' : ''}`}
                onClick={() => setTabMode('empty')}
              >
                <Icon name="archive" size={13} />
                <div>
                  <strong>{t.createChildModal.tabModeEmpty}</strong>
                  <span>{t.createChildModal.tabModeEmptySub}</span>
                </div>
              </button>

              <button
                type="button"
                className={`mode-tab-btn ${tabMode === 'parent' ? 'active' : ''}`}
                onClick={() => setTabMode('parent')}
              >
                <Icon name="layout" size={13} />
                <div>
                  <strong>{t.createChildModal.tabModeParent}</strong>
                  <span>{t.createChildModal.tabModeParentSub.replace('{parent}', selectedParent.name)}</span>
                </div>
              </button>

              {validWindowTabs.length > 0 && (
                <button
                  type="button"
                  className={`mode-tab-btn ${tabMode === 'window' ? 'active' : ''}`}
                  onClick={() => setTabMode('window')}
                >
                  <Icon name="layers" size={13} />
                  <div>
                    <strong>{t.createChildModal.tabModeWindow}</strong>
                    <span>{t.createChildModal.tabModeWindowSub}</span>
                  </div>
                </button>
              )}
            </div>

            {/* If tabMode === 'parent': show parent tabs list */}
            {tabMode === 'parent' && (
              <div className="create-child-tabs-container">
                <div className="send-tabs-section-heading" style={{ marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {selectedParentTabIndices.size} / {parentTabs.length} tabs
                  </span>
                  <div className="send-tabs-tab-actions">
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={selectAllParentTabs}
                      disabled={busy || selectedParentTabIndices.size === parentTabs.length}
                    >
                      <Icon name="check-square" size={12} />
                      <span>{t.common.selectAll}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={deselectAllParentTabs}
                      disabled={busy || selectedParentTabIndices.size === 0}
                    >
                      <Icon name="square" size={12} />
                      <span>{t.common.deselectAll}</span>
                    </button>
                  </div>
                </div>

                {parentTabs.length > 4 && (
                  <div className="send-tabs-search-mini" style={{ marginBottom: '8px' }}>
                    <Icon name="search" size={12} />
                    <input
                      type="text"
                      placeholder={t.createChildModal.searchTabsPlaceholder}
                      value={tabSearch}
                      onChange={(e) => setTabSearch(e.target.value)}
                    />
                  </div>
                )}

                <div className="send-tabs-list" style={{ maxHeight: '180px' }}>
                  {filteredParentTabs.map((tab, idx) => {
                    const originalIdx = parentTabs.findIndex((t) => t.id === tab.id);
                    const isChecked = selectedParentTabIndices.has(originalIdx);
                    return (
                      <div
                        key={tab.id}
                        className={`send-tabs-item ${isChecked ? 'is-selected' : ''}`}
                        onClick={() => toggleParentTab(originalIdx)}
                        role="checkbox"
                        aria-checked={isChecked}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            toggleParentTab(originalIdx);
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
                            {tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : tab.hostname[0]?.toUpperCase() || 'W'}
                          </div>
                        </div>
                        <div className="dedup-content-col">
                          <h4 className="dedup-title" title={tab.title}>
                            {tab.title}
                          </h4>
                          <div className="dedup-url-row">
                            <span className="dedup-url" title={tab.url}>
                              {tab.hostname} · {tab.url}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {filteredParentTabs.length === 0 && (
                    <p className="empty-copy">{t.createChildModal.noParentTabs}</p>
                  )}
                </div>

                <div className="send-tabs-option-row" style={{ marginTop: '8px' }}>
                  <label className="send-tabs-option-label">
                    <input
                      type="checkbox"
                      checked={removeTabsFromParent}
                      onChange={(e) => setRemoveTabsFromParent(e.target.checked)}
                      disabled={busy}
                    />
                    <div className="send-tabs-option-text">
                      <strong>{t.createChildModal.moveFromParentCheck}</strong>
                      <span>{t.createChildModal.moveFromParentHint}</span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* If tabMode === 'window': show window tabs list */}
            {tabMode === 'window' && (
              <div className="create-child-tabs-container">
                <div className="send-tabs-section-heading" style={{ marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {selectedWindowTabIndices.size} / {validWindowTabs.length} tabs
                  </span>
                  <div className="send-tabs-tab-actions">
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={selectAllWindowTabs}
                      disabled={busy || selectedWindowTabIndices.size === validWindowTabs.length}
                    >
                      <Icon name="check-square" size={12} />
                      <span>{t.common.selectAll}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={deselectAllWindowTabs}
                      disabled={busy || selectedWindowTabIndices.size === 0}
                    >
                      <Icon name="square" size={12} />
                      <span>{t.common.deselectAll}</span>
                    </button>
                  </div>
                </div>

                <div className="send-tabs-list" style={{ maxHeight: '180px' }}>
                  {filteredWindowTabs.map((tab, idx) => {
                    const originalIdx = validWindowTabs.findIndex((t) => t.url === tab.url);
                    const isChecked = selectedWindowTabIndices.has(originalIdx);
                    return (
                      <div
                        key={`${tab.url}_${idx}`}
                        className={`send-tabs-item ${isChecked ? 'is-selected' : ''}`}
                        onClick={() => toggleWindowTab(originalIdx)}
                        role="checkbox"
                        aria-checked={isChecked}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            toggleWindowTab(originalIdx);
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
                            {tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : tab.hostname[0]?.toUpperCase() || 'W'}
                          </div>
                        </div>
                        <div className="dedup-content-col">
                          <h4 className="dedup-title" title={tab.title}>
                            {tab.title}
                          </h4>
                          <div className="dedup-url-row">
                            <span className="dedup-url" title={tab.url}>
                              {tab.hostname} · {tab.url}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {filteredWindowTabs.length === 0 && (
                    <p className="empty-copy">{t.createChildModal.noWindowTabs}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="send-tabs-modal-footer">
            <div className="send-tabs-footer-summary">
              {selectedInitialTabs.length > 0 ? (
                <span>
                  {t.createChildModal.summaryWithTabs
                    .replace('{name}', name.trim() || `${selectedParent.name} - Con`)
                    .replace('{count}', String(selectedInitialTabs.length))}
                </span>
              ) : (
                <span>
                  {t.createChildModal.summaryEmpty.replace(
                    '{name}',
                    name.trim() || `${selectedParent.name} - Con`
                  )}
                </span>
              )}
            </div>

            <div className="send-tabs-footer-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={onClose}
                disabled={busy}
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="primary-button compact"
                disabled={busy || !name.trim()}
              >
                <Icon name="plus" size={14} />
                <span>
                  {busy
                    ? t.createChildModal.submittingBtn
                    : `${t.createChildModal.submitBtn}${
                        selectedInitialTabs.length > 0 ? ` (${selectedInitialTabs.length} tabs)` : ''
                      }`}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
