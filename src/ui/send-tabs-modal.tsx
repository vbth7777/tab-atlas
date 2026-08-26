import { useState, useMemo, useEffect } from 'react';
import type { Workspace } from '@/src/domain/workspace';
import { extractWebUrl } from '@/src/domain/workspace-service';
import { Icon, WorkspaceBadge } from '@/src/ui/components';
import { sendMessage } from '@/src/shared/messages';
import { useI18n } from '@/src/shared/i18n';

export interface SourceTabItem {
  id?: number;
  title?: string;
  url?: string;
  pendingUrl?: string;
  favIconUrl?: string;
}

interface SendTabsModalProps {
  workspaces: Workspace[];
  sourceTabs: SourceTabItem[];
  initialTargetWorkspaceId?: string;
  onClose: () => void;
  onConfirm: (
    targetWorkspaceId: string,
    selectedTabs: Array<{ id?: number; url: string; title?: string; faviconUrl?: string }>,
    closeSource: boolean
  ) => Promise<void>;
}

export function SendTabsModal({
  workspaces,
  sourceTabs,
  initialTargetWorkspaceId,
  onClose,
  onConfirm,
}: SendTabsModalProps) {
  const { lang, t } = useI18n();

  // Filter out non-web tabs from source tabs
  const validSourceTabs = useMemo(() => {
    return sourceTabs
      .map((tabItem) => {
        const rawUrl = tabItem.pendingUrl || tabItem.url;
        const webUrl = extractWebUrl(rawUrl);
        if (!webUrl) return null;

        let hostname = webUrl;
        try {
          hostname = new URL(webUrl).hostname.replace(/^www\./, '');
        } catch {}

        return {
          id: tabItem.id,
          title: tabItem.title || hostname,
          url: webUrl,
          faviconUrl: tabItem.favIconUrl,
          hostname,
        };
      })
      .filter((tabItem): tabItem is NonNullable<typeof tabItem> => tabItem !== null);
  }, [sourceTabs]);

  // Selected target workspace
  const [targetId, setTargetId] = useState<string>(() => {
    if (initialTargetWorkspaceId && workspaces.some((w) => w.id === initialTargetWorkspaceId)) {
      return initialTargetWorkspaceId;
    }
    return workspaces[0]?.id || '';
  });

  // Selected source tab URLs or IDs (default: select all source tabs)
  const [selectedTabIndices, setSelectedTabIndices] = useState<Set<number>>(
    () => new Set(validSourceTabs.map((_, idx) => idx))
  );

  const [closeSource, setCloseSource] = useState(false);
  const [wsSearch, setWsSearch] = useState('');
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

  const filteredWorkspaces = useMemo(() => {
    const q = wsSearch.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter((w) => w.name.toLowerCase().includes(q));
  }, [workspaces, wsSearch]);

  const targetWorkspace = useMemo(() => {
    return workspaces.find((w) => w.id === targetId) || null;
  }, [workspaces, targetId]);

  const selectedTabsList = useMemo(() => {
    return validSourceTabs.filter((_, idx) => selectedTabIndices.has(idx));
  }, [validSourceTabs, selectedTabIndices]);

  const toggleTab = (idx: number) => {
    if (busy) return;
    setSelectedTabIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedTabIndices(new Set(validSourceTabs.map((_, idx) => idx)));
  };

  const deselectAll = () => {
    setSelectedTabIndices(new Set());
  };

  const handleInspectTab = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    sendMessage({ type: 'open-tab', url });
  };

  const handleSubmit = async () => {
    if (!targetId || selectedTabsList.length === 0 || busy) return;
    setBusy(true);
    try {
      await onConfirm(
        targetId,
        selectedTabsList.map((tabItem) => ({
          id: tabItem.id,
          url: tabItem.url,
          title: tabItem.title,
          faviconUrl: tabItem.faviconUrl,
        })),
        closeSource
      );
      onClose();
    } catch (err) {
      console.error('Failed to send tabs to workspace:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="send-tabs-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="send-tabs-title">
      <div className="send-tabs-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="send-tabs-modal-header">
          <div className="send-tabs-modal-header-info">
            <div className="send-tabs-modal-icon">
              <Icon name="layers" size={18} />
            </div>
            <div>
              <h2 id="send-tabs-title" className="send-tabs-modal-title">
                {t.sendModal.title}
              </h2>
              <p className="send-tabs-modal-subtitle">
                {t.sendModal.subtitle}
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
        <div className="send-tabs-modal-body">
          {/* Section 1: Choose Target Workspace */}
          <div className="send-tabs-section">
            <div className="send-tabs-section-heading">
              <h3>{t.sendModal.section1Title}</h3>
              {workspaces.length > 5 && (
                <div className="send-tabs-search-mini">
                  <Icon name="search" size={12} />
                  <input
                    type="text"
                    placeholder={t.sendModal.searchWsPlaceholder}
                    value={wsSearch}
                    onChange={(e) => setWsSearch(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="send-tabs-ws-grid">
              {filteredWorkspaces.map((ws) => {
                const isSelected = ws.id === targetId;
                return (
                  <div
                    key={ws.id}
                    className={`send-tabs-ws-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => !busy && setTargetId(ws.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        setTargetId(ws.id);
                      }
                    }}
                  >
                    <div className="send-tabs-ws-color-col">
                      <span className={`workspace-color ${ws.color}`} />
                    </div>
                    <div className="send-tabs-ws-info">
                      <div className="send-tabs-ws-name-row">
                        <strong title={ws.name}>{ws.name}</strong>
                      </div>
                      <div className="send-tabs-ws-meta">
                        <span>{ws.tabs.length} tabs</span>
                        <span className="dedup-dot">·</span>
                        <WorkspaceBadge workspace={ws} lang={lang} />
                      </div>
                    </div>
                    <div className="send-tabs-ws-radio">
                      <span className={`send-tabs-radio-dot ${isSelected ? 'selected' : ''}`}>
                        {isSelected && <Icon name="check" size={11} />}
                      </span>
                    </div>
                  </div>
                );
              })}
              {filteredWorkspaces.length === 0 && (
                <p className="empty-copy">{t.sendModal.noMatchingWs}</p>
              )}
            </div>
          </div>

          {/* Section 2: Choose Source Tabs */}
          <div className="send-tabs-section" style={{ marginTop: '18px' }}>
            <div className="send-tabs-section-heading">
              <h3>
                {t.sendModal.section2Title
                  .replace('{selected}', String(selectedTabsList.length))
                  .replace('{total}', String(validSourceTabs.length))}
              </h3>
              <div className="send-tabs-tab-actions">
                <button
                  type="button"
                  className="ghost-button compact"
                  onClick={selectAll}
                  disabled={busy || selectedTabsList.length === validSourceTabs.length}
                >
                  <Icon name="check-square" size={12} />
                  <span>{t.common.selectAll}</span>
                </button>
                <button
                  type="button"
                  className="ghost-button compact"
                  onClick={deselectAll}
                  disabled={busy || selectedTabsList.length === 0}
                >
                  <Icon name="square" size={12} />
                  <span>{t.common.deselectAll}</span>
                </button>
              </div>
            </div>

            <div className="send-tabs-list">
              {validSourceTabs.map((tabItem, idx) => {
                const isChecked = selectedTabIndices.has(idx);
                return (
                  <div
                    key={`${tabItem.url}_${idx}`}
                    className={`send-tabs-item ${isChecked ? 'is-selected' : ''}`}
                    onClick={() => toggleTab(idx)}
                    role="checkbox"
                    aria-checked={isChecked}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        toggleTab(idx);
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
                        {tabItem.faviconUrl ? (
                          <img src={tabItem.faviconUrl} alt="" />
                        ) : (
                          tabItem.hostname[0]?.toUpperCase() || 'W'
                        )}
                      </div>
                    </div>

                    <div className="dedup-content-col">
                      <h4 className="dedup-title" title={tabItem.title}>
                        {tabItem.title}
                      </h4>
                      <div className="dedup-url-row">
                        <span className="dedup-url" title={tabItem.url}>
                          {tabItem.hostname}
                          <span className="dedup-dot">·</span>
                          {tabItem.url}
                        </span>
                        <button
                          type="button"
                          className="dedup-inspect-btn"
                          onClick={(e) => handleInspectTab(e, tabItem.url)}
                          title={t.deduplicateModal.inspectTabTitle}
                          aria-label={`${t.deduplicateModal.inspectTab} ${tabItem.title}`}
                        >
                          <Icon name="arrow-up-right" size={12} />
                          <span>{t.deduplicateModal.inspectTab}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {validSourceTabs.length === 0 && (
                <p className="empty-copy">{t.sendModal.noValidTabs}</p>
              )}
            </div>
          </div>

          {/* Section 3: Option to close source tabs */}
          <div className="send-tabs-option-row">
            <label className="send-tabs-option-label">
              <input
                type="checkbox"
                checked={closeSource}
                onChange={(e) => setCloseSource(e.target.checked)}
                disabled={busy}
              />
              <div className="send-tabs-option-text">
                <strong>{t.sendModal.closeSourceCheck}</strong>
                <span>{t.sendModal.closeSourceHint}</span>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="send-tabs-modal-footer">
          <div className="send-tabs-footer-summary">
            {targetWorkspace ? (
              <span>
                {(closeSource ? t.sendModal.summaryMove : t.sendModal.summaryCopy)
                  .replace('{count}', String(selectedTabsList.length))
                  .replace('{target}', targetWorkspace.name)}
              </span>
            ) : (
              <span>{t.sendModal.pleaseSelectWs}</span>
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
              onClick={handleSubmit}
              disabled={busy || !targetWorkspace || selectedTabsList.length === 0}
            >
              <Icon name={closeSource ? 'arrow-up-right' : 'copy'} size={14} />
              <span>
                {busy
                  ? t.sendModal.submittingBtn
                  : (closeSource ? t.sendModal.submitMoveBtn : t.sendModal.submitCopyBtn)
                      .replace('{count}', String(selectedTabsList.length))}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
