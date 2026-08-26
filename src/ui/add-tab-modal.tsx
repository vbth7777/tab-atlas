import { useState, useMemo, useEffect } from 'react';
import type { Workspace } from '@/src/domain/workspace';
import { extractWebUrl } from '@/src/domain/workspace-service';
import { Icon, WorkspaceBadge } from '@/src/ui/components';
import { useI18n } from '@/src/shared/i18n';
import type { SourceTabItem } from '@/src/ui/send-tabs-modal';

interface AddTabModalProps {
  targetWorkspace: Workspace;
  allWorkspaces: Workspace[];
  openWindowTabs?: SourceTabItem[];
  onClose: () => void;
  onConfirm: (params: {
    tabs: Array<{ id?: number; url: string; title?: string; faviconUrl?: string }>;
    closeSourceTabIds?: number[];
    removeFromSourceWsId?: string;
    sourceTabIds?: string[];
  }) => Promise<void>;
}

export function AddTabModal({
  targetWorkspace,
  allWorkspaces,
  openWindowTabs = [],
  onClose,
  onConfirm,
}: AddTabModalProps) {
  const { lang, t } = useI18n();

  const [sourceType, setSourceType] = useState<'direct' | 'window' | 'workspace'>('direct');
  const [busy, setBusy] = useState(false);

  // Tab 1: Direct URL Input
  const [directUrl, setDirectUrl] = useState('');
  const [directTitle, setDirectTitle] = useState('');
  const [urlError, setUrlError] = useState('');

  // Tab 2: Open Window Tabs
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

  const [selectedWindowTabIndices, setSelectedWindowTabIndices] = useState<Set<number>>(
    () => new Set(validWindowTabs.map((_, i) => i))
  );
  const [closeWindowTabs, setCloseWindowTabs] = useState(false);
  const [windowTabSearch, setWindowTabSearch] = useState('');

  // Tab 3: Other Workspace Tabs
  const otherWorkspaces = useMemo(() => {
    return allWorkspaces.filter((w) => w.id !== targetWorkspace.id);
  }, [allWorkspaces, targetWorkspace.id]);

  const [selectedOtherWsId, setSelectedOtherWsId] = useState<string>(otherWorkspaces[0]?.id || '');
  const selectedOtherWs = useMemo(() => {
    return otherWorkspaces.find((w) => w.id === selectedOtherWsId) || null;
  }, [otherWorkspaces, selectedOtherWsId]);

  const otherWsTabs = useMemo(() => {
    return selectedOtherWs?.tabs || [];
  }, [selectedOtherWs]);

  const [selectedOtherWsTabIds, setSelectedOtherWsTabIds] = useState<Set<string>>(new Set());
  const [removeFromOtherWs, setRemoveFromOtherWs] = useState(false);
  const [otherWsTabSearch, setOtherWsTabSearch] = useState('');

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

  // Filtered lists
  const filteredWindowTabs = useMemo(() => {
    if (!windowTabSearch.trim()) return validWindowTabs;
    const q = windowTabSearch.trim().toLowerCase();
    return validWindowTabs.filter(
      (t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q) || t.hostname.toLowerCase().includes(q)
    );
  }, [validWindowTabs, windowTabSearch]);

  const filteredOtherWsTabs = useMemo(() => {
    if (!otherWsTabSearch.trim()) return otherWsTabs;
    const q = otherWsTabSearch.trim().toLowerCase();
    return otherWsTabs.filter(
      (t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q) || t.hostname.toLowerCase().includes(q)
    );
  }, [otherWsTabs, otherWsTabSearch]);

  const toggleWindowTab = (idx: number) => {
    if (busy) return;
    setSelectedWindowTabIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleOtherWsTab = (tabId: string) => {
    if (busy) return;
    setSelectedOtherWsTabIds((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId);
      else next.add(tabId);
      return next;
    });
  };

  const handleDirectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError('');

    let raw = directUrl.trim();
    if (!raw) return;

    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
      raw = `https://${raw}`;
    }

    const cleanUrl = extractWebUrl(raw);
    if (!cleanUrl) {
      setUrlError(t.addTabModal.urlInvalidError);
      return;
    }

    let hostname = cleanUrl;
    try {
      hostname = new URL(cleanUrl).hostname.replace(/^www\./, '');
    } catch {}

    const title = directTitle.trim() || hostname;

    setBusy(true);
    try {
      await onConfirm({
        tabs: [{ url: cleanUrl, title }],
      });
      onClose();
    } catch (err) {
      console.error('Failed to add tab:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleWindowTabsSubmit = async () => {
    const selected = validWindowTabs.filter((_, idx) => selectedWindowTabIndices.has(idx));
    if (selected.length === 0 || busy) return;

    const closeIds = closeWindowTabs
      ? selected.map((t) => t.id).filter((id): id is number => id !== undefined)
      : undefined;

    setBusy(true);
    try {
      await onConfirm({
        tabs: selected.map((t) => ({ id: t.id, url: t.url, title: t.title, faviconUrl: t.faviconUrl })),
        closeSourceTabIds: closeIds,
      });
      onClose();
    } catch (err) {
      console.error('Failed to add window tabs:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleOtherWsTabsSubmit = async () => {
    if (!selectedOtherWs || selectedOtherWsTabIds.size === 0 || busy) return;

    const selected = otherWsTabs.filter((t) => selectedOtherWsTabIds.has(t.id));
    if (selected.length === 0) return;

    setBusy(true);
    try {
      await onConfirm({
        tabs: selected.map((t) => ({ url: t.url, title: t.title, faviconUrl: t.faviconUrl })),
        removeFromSourceWsId: removeFromOtherWs ? selectedOtherWs.id : undefined,
        sourceTabIds: removeFromOtherWs ? Array.from(selectedOtherWsTabIds) : undefined,
      });
      onClose();
    } catch (err) {
      console.error('Failed to add tabs from other workspace:', err);
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
      aria-labelledby="add-tab-modal-title"
    >
      <div className="send-tabs-modal-card add-tab-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="send-tabs-modal-header">
          <div className="send-tabs-modal-header-info">
            <div className="send-tabs-modal-icon" style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399' }}>
              <Icon name="plus" size={18} />
            </div>
            <div>
              <h2 id="add-tab-modal-title" className="send-tabs-modal-title">
                {t.addTabModal.title}
              </h2>
              <p className="send-tabs-modal-subtitle">
                {t.addTabModal.subtitle
                  .replace('{target}', targetWorkspace.name)
                  .replace('{currentCount}', String(targetWorkspace.tabs.length))}
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

        {/* Source Navigation Tabs */}
        <div className="add-tab-source-nav">
          <button
            type="button"
            className={`source-nav-btn ${sourceType === 'direct' ? 'active' : ''}`}
            onClick={() => setSourceType('direct')}
          >
            <Icon name="arrow-up-right" size={13} />
            <span>{t.addTabModal.tabDirect}</span>
          </button>

          {validWindowTabs.length > 0 && (
            <button
              type="button"
              className={`source-nav-btn ${sourceType === 'window' ? 'active' : ''}`}
              onClick={() => setSourceType('window')}
            >
              <Icon name="layout" size={13} />
              <span>{t.addTabModal.tabWindow} ({validWindowTabs.length})</span>
            </button>
          )}

          {otherWorkspaces.length > 0 && (
            <button
              type="button"
              className={`source-nav-btn ${sourceType === 'workspace' ? 'active' : ''}`}
              onClick={() => setSourceType('workspace')}
            >
              <Icon name="layers" size={13} />
              <span>{t.addTabModal.tabWorkspace}</span>
            </button>
          )}
        </div>

        {/* Modal Body Based on Source Type */}
        <div className="send-tabs-modal-body">
          {/* Tab 1: Direct URL */}
          {sourceType === 'direct' && (
            <form onSubmit={handleDirectSubmit} style={{ display: 'grid', gap: '14px', marginTop: '6px' }}>
              <label className="create-child-label">
                <strong>{t.addTabModal.urlInputLabel}</strong>
                <input
                  type="text"
                  autoFocus
                  className="create-child-input"
                  placeholder={t.addTabModal.urlInputPlaceholder}
                  value={directUrl}
                  onChange={(e) => {
                    setDirectUrl(e.target.value);
                    if (urlError) setUrlError('');
                  }}
                  required
                />
              </label>

              <label className="create-child-label">
                <strong>{t.addTabModal.titleInputLabel}</strong>
                <input
                  type="text"
                  className="create-child-input"
                  placeholder={t.addTabModal.titleInputPlaceholder}
                  value={directTitle}
                  onChange={(e) => setDirectTitle(e.target.value)}
                />
              </label>

              {urlError && <p style={{ color: '#fb7185', fontSize: '11px', margin: 0 }}>{urlError}</p>}

              <div className="send-tabs-modal-footer" style={{ marginTop: '12px', padding: 0, border: 'none' }}>
                <div />
                <div className="send-tabs-footer-actions">
                  <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
                    {t.common.cancel}
                  </button>
                  <button type="submit" className="primary-button compact" disabled={busy || !directUrl.trim()}>
                    <Icon name="plus" size={14} />
                    <span>{busy ? t.addTabModal.submittingBtn : t.addTabModal.addSingleUrlBtn}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Tab 2: Open Window Tabs */}
          {sourceType === 'window' && (
            <div>
              <div className="send-tabs-section-heading" style={{ marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {selectedWindowTabIndices.size} / {validWindowTabs.length} tabs
                </span>
                <div className="send-tabs-tab-actions">
                  <button
                    type="button"
                    className="ghost-button compact"
                    onClick={() => setSelectedWindowTabIndices(new Set(validWindowTabs.map((_, i) => i)))}
                    disabled={busy || selectedWindowTabIndices.size === validWindowTabs.length}
                  >
                    <Icon name="check-square" size={12} />
                    <span>{t.common.selectAll}</span>
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact"
                    onClick={() => setSelectedWindowTabIndices(new Set())}
                    disabled={busy || selectedWindowTabIndices.size === 0}
                  >
                    <Icon name="square" size={12} />
                    <span>{t.common.deselectAll}</span>
                  </button>
                </div>
              </div>

              {validWindowTabs.length > 4 && (
                <div className="send-tabs-search-mini" style={{ marginBottom: '8px' }}>
                  <Icon name="search" size={12} />
                  <input
                    type="text"
                    placeholder={t.createChildModal.searchTabsPlaceholder}
                    value={windowTabSearch}
                    onChange={(e) => setWindowTabSearch(e.target.value)}
                  />
                </div>
              )}

              <div className="send-tabs-list" style={{ maxHeight: '200px' }}>
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
              </div>

              <div className="send-tabs-option-row" style={{ marginTop: '10px' }}>
                <label className="send-tabs-option-label">
                  <input
                    type="checkbox"
                    checked={closeWindowTabs}
                    onChange={(e) => setCloseWindowTabs(e.target.checked)}
                    disabled={busy}
                  />
                  <div className="send-tabs-option-text">
                    <strong>{t.addTabModal.closeSourceCheck}</strong>
                    <span>{t.addTabModal.closeSourceHint}</span>
                  </div>
                </label>
              </div>

              <div className="send-tabs-modal-footer" style={{ marginTop: '14px', padding: 0, border: 'none' }}>
                <div />
                <div className="send-tabs-footer-actions">
                  <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
                    {t.common.cancel}
                  </button>
                  <button
                    type="button"
                    className="primary-button compact"
                    onClick={handleWindowTabsSubmit}
                    disabled={busy || selectedWindowTabIndices.size === 0}
                  >
                    <Icon name="plus" size={14} />
                    <span>
                      {busy
                        ? t.addTabModal.submittingBtn
                        : t.addTabModal.submitCountBtn.replace('{count}', String(selectedWindowTabIndices.size))}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Other Workspace Tabs */}
          {sourceType === 'workspace' && (
            <div>
              <div style={{ marginBottom: '12px' }}>
                <label className="create-child-label">
                  <strong>{t.addTabModal.chooseWsLabel}</strong>
                  <select
                    className="create-child-select"
                    value={selectedOtherWsId}
                    onChange={(e) => {
                      setSelectedOtherWsId(e.target.value);
                      setSelectedOtherWsTabIds(new Set());
                    }}
                    disabled={busy}
                  >
                    {otherWorkspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.tabs.length} tabs)
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {selectedOtherWs && (
                <div>
                  <div className="send-tabs-section-heading" style={{ marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {selectedOtherWsTabIds.size} / {otherWsTabs.length} tabs
                    </span>
                    <div className="send-tabs-tab-actions">
                      <button
                        type="button"
                        className="ghost-button compact"
                        onClick={() => setSelectedOtherWsTabIds(new Set(otherWsTabs.map((t) => t.id)))}
                        disabled={busy || selectedOtherWsTabIds.size === otherWsTabs.length}
                      >
                        <Icon name="check-square" size={12} />
                        <span>{t.common.selectAll}</span>
                      </button>
                      <button
                        type="button"
                        className="ghost-button compact"
                        onClick={() => setSelectedOtherWsTabIds(new Set())}
                        disabled={busy || selectedOtherWsTabIds.size === 0}
                      >
                        <Icon name="square" size={12} />
                        <span>{t.common.deselectAll}</span>
                      </button>
                    </div>
                  </div>

                  {otherWsTabs.length > 4 && (
                    <div className="send-tabs-search-mini" style={{ marginBottom: '8px' }}>
                      <Icon name="search" size={12} />
                      <input
                        type="text"
                        placeholder={t.createChildModal.searchTabsPlaceholder}
                        value={otherWsTabSearch}
                        onChange={(e) => setOtherWsTabSearch(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="send-tabs-list" style={{ maxHeight: '180px' }}>
                    {filteredOtherWsTabs.map((tab) => {
                      const isChecked = selectedOtherWsTabIds.has(tab.id);
                      return (
                        <div
                          key={tab.id}
                          className={`send-tabs-item ${isChecked ? 'is-selected' : ''}`}
                          onClick={() => toggleOtherWsTab(tab.id)}
                          role="checkbox"
                          aria-checked={isChecked}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              toggleOtherWsTab(tab.id);
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
                    {filteredOtherWsTabs.length === 0 && (
                      <p className="empty-copy">{t.dashboard.emptyTabsInWs}</p>
                    )}
                  </div>

                  <div className="send-tabs-option-row" style={{ marginTop: '10px' }}>
                    <label className="send-tabs-option-label">
                      <input
                        type="checkbox"
                        checked={removeFromOtherWs}
                        onChange={(e) => setRemoveFromOtherWs(e.target.checked)}
                        disabled={busy}
                      />
                      <div className="send-tabs-option-text">
                        <strong>{t.addTabModal.moveFromOtherWsCheck}</strong>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              <div className="send-tabs-modal-footer" style={{ marginTop: '14px', padding: 0, border: 'none' }}>
                <div />
                <div className="send-tabs-footer-actions">
                  <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
                    {t.common.cancel}
                  </button>
                  <button
                    type="button"
                    className="primary-button compact"
                    onClick={handleOtherWsTabsSubmit}
                    disabled={busy || selectedOtherWsTabIds.size === 0}
                  >
                    <Icon name="plus" size={14} />
                    <span>
                      {busy
                        ? t.addTabModal.submittingBtn
                        : t.addTabModal.submitCountBtn.replace('{count}', String(selectedOtherWsTabIds.size))}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
