import { useState, useMemo, useEffect } from 'react';
import type { Workspace } from '@/src/domain/workspace';
import { Icon } from '@/src/ui/components';
import { useI18n } from '@/src/shared/i18n';

interface SplitWorkspaceModalProps {
  workspace: Workspace;
  onClose: () => void;
  onConfirm: (params: {
    splitMode: 'by_tab_count' | 'by_child_count';
    value: number;
    childNamePrefix?: string;
    moveTabs?: boolean;
  }) => Promise<void>;
}

export function SplitWorkspaceModal({ workspace, onClose, onConfirm }: SplitWorkspaceModalProps) {
  const { t } = useI18n();
  const totalTabs = workspace.tabs.length;
  const [splitMode, setSplitMode] = useState<'by_tab_count' | 'by_child_count'>('by_tab_count');
  const [tabCountValue, setTabCountValue] = useState<number>(() => Math.min(20, Math.max(5, Math.ceil(totalTabs / 4))));
  const [childCountValue, setChildCountValue] = useState<number>(3);
  const [namePrefix, setNamePrefix] = useState(`${workspace.name} ${t.splitModal.defaultPrefixPostfix}`);
  const [moveTabs, setMoveTabs] = useState(true);
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

  // Calculations for chunks & preview
  const { childCount, chunkSize, chunks } = useMemo(() => {
    if (totalTabs === 0) {
      return { childCount: 0, chunkSize: 0, chunks: [] };
    }

    let cSize = 1;
    let cCount = 1;

    if (splitMode === 'by_tab_count') {
      cSize = Math.max(1, Math.min(totalTabs, tabCountValue || 1));
      cCount = Math.ceil(totalTabs / cSize);
    } else {
      cCount = Math.max(1, Math.min(totalTabs, childCountValue || 1));
      cSize = Math.ceil(totalTabs / cCount);
    }

    const calculatedChunks: typeof workspace.tabs[] = [];
    for (let i = 0; i < totalTabs; i += cSize) {
      calculatedChunks.push(workspace.tabs.slice(i, i + cSize));
    }

    return {
      childCount: calculatedChunks.length,
      chunkSize: cSize,
      chunks: calculatedChunks,
    };
  }, [totalTabs, splitMode, tabCountValue, childCountValue, workspace.tabs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalTabs === 0 || busy || childCount === 0) return;

    setBusy(true);
    try {
      await onConfirm({
        splitMode,
        value: splitMode === 'by_tab_count' ? tabCountValue : childCountValue,
        childNamePrefix: namePrefix.trim() || undefined,
        moveTabs,
      });
      onClose();
    } catch (err) {
      console.error('Failed to split workspace:', err);
    } finally {
      setBusy(false);
    }
  };

  const colors = ['#818cf8', '#38bdf8', '#2dd4bf', '#34d399', '#fbbf24', '#fb923c', '#fb7185', '#a78bfa'];

  return (
    <div
      className="dedup-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-modal-title"
    >
      <div className="split-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="split-modal-header">
          <div className="split-modal-header-info">
            <div className="split-modal-icon">
              <Icon name="split" size={20} />
            </div>
            <div>
              <h2 id="split-modal-title" className="split-modal-title">
                {t.splitModal.title}
              </h2>
              <p className="split-modal-subtitle">
                {t.splitModal.subtitle
                  .replace('{name}', workspace.name)
                  .replace('{count}', String(totalTabs))}
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

        <form onSubmit={handleSubmit} className="split-modal-body">
          {/* Mode Selector */}
          <div className="split-mode-selector">
            <button
              type="button"
              className={`split-mode-tab ${splitMode === 'by_tab_count' ? 'active' : ''}`}
              onClick={() => setSplitMode('by_tab_count')}
            >
              <Icon name="layers" size={15} />
              <div className="split-mode-tab-text">
                <strong>{t.splitModal.modeByTabCount}</strong>
                <small>{t.splitModal.modeByTabCountSub}</small>
              </div>
            </button>
            <button
              type="button"
              className={`split-mode-tab ${splitMode === 'by_child_count' ? 'active' : ''}`}
              onClick={() => setSplitMode('by_child_count')}
            >
              <Icon name="layout" size={15} />
              <div className="split-mode-tab-text">
                <strong>{t.splitModal.modeByChildCount}</strong>
                <small>{t.splitModal.modeByChildCountSub}</small>
              </div>
            </button>
          </div>

          {/* Controls based on active mode */}
          <div className="split-control-section">
            {splitMode === 'by_tab_count' ? (
              <div className="split-field-group">
                <label htmlFor="tab-count-input">
                  {t.splitModal.tabCountInputLabel}
                </label>
                <div className="split-input-row">
                  <input
                    id="tab-count-input"
                    type="number"
                    min={1}
                    max={totalTabs || 1}
                    value={tabCountValue}
                    onChange={(e) => setTabCountValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    disabled={busy}
                  />
                  <div className="split-preset-chips">
                    {[10, 15, 20, 25, 50]
                      .filter((n) => n <= totalTabs || n === 10)
                      .map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`preset-chip ${tabCountValue === n ? 'active' : ''}`}
                          onClick={() => setTabCountValue(n)}
                        >
                          {t.splitModal.presetTabsChip.replace('{count}', String(n))}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="split-field-group">
                <label htmlFor="child-count-input">
                  {t.splitModal.childCountInputLabel}
                </label>
                <div className="split-input-row">
                  <input
                    id="child-count-input"
                    type="number"
                    min={2}
                    max={Math.min(totalTabs, 20) || 2}
                    value={childCountValue}
                    onChange={(e) => setChildCountValue(Math.max(2, parseInt(e.target.value, 10) || 2))}
                    disabled={busy}
                  />
                  <div className="split-preset-chips">
                    {[2, 3, 4, 5, 8]
                      .filter((n) => n <= totalTabs)
                      .map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`preset-chip ${childCountValue === n ? 'active' : ''}`}
                          onClick={() => setChildCountValue(n)}
                        >
                          {t.splitModal.presetGroupsChip.replace('{count}', String(n))}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* Custom Prefix Naming */}
            <div className="split-field-group">
              <label htmlFor="prefix-input">{t.splitModal.prefixInputLabel}</label>
              <input
                id="prefix-input"
                type="text"
                value={namePrefix}
                onChange={(e) => setNamePrefix(e.target.value)}
                placeholder={t.splitModal.prefixInputPlaceholder}
                disabled={busy}
              />
              <span className="field-hint">
                {t.splitModal.prefixInputHint.replace('{prefix}', namePrefix || t.splitModal.defaultChildName)}
              </span>
            </div>

            {/* Move Tabs Checkbox */}
            <label className="check-label split-move-check">
              <input
                type="checkbox"
                checked={moveTabs}
                onChange={(e) => setMoveTabs(e.target.checked)}
                disabled={busy}
              />
              <span>
                <strong>{t.splitModal.moveTabsCheck}</strong>
              </span>
            </label>
          </div>

          {/* Realtime Calculation Banner */}
          <div className="split-calc-banner">
            <div className="calc-icon">
              <Icon name="sparkles" size={16} />
            </div>
            <div className="calc-info">
              <strong>{t.splitModal.calcBannerTitle}</strong>
              <span>
                {t.splitModal.calcBannerText
                  .replace('{total}', String(totalTabs))
                  .replace('{children}', String(childCount))
                  .replace('{chunkSize}', String(chunkSize))}
              </span>
            </div>
          </div>

          {/* Preview List */}
          <div className="split-preview-section">
            <div className="preview-heading">
              <span>{t.splitModal.previewHeading}</span>
            </div>
            <div className="split-preview-list">
              {chunks.map((chunk, idx) => (
                <div key={idx} className="split-preview-item">
                  <div
                    className="preview-color-pill"
                    style={{ backgroundColor: colors[idx % colors.length] }}
                  />
                  <div className="preview-item-info">
                    <div className="preview-item-header">
                      <strong>
                        {namePrefix || t.splitModal.defaultChildName} {idx + 1}
                      </strong>
                      <span className="preview-tab-count">
                        <Icon name="layers" size={11} />
                        {t.splitModal.previewTabCount.replace('{count}', String(chunk.length))}
                      </span>
                    </div>
                    <div className="preview-tab-samples">
                      {chunk.slice(0, 2).map((tabItem, tIdx) => (
                        <span key={tabItem.id || tIdx} className="tab-sample-title" title={tabItem.title}>
                          • {tabItem.title || tabItem.url}
                        </span>
                      ))}
                      {chunk.length > 2 && (
                        <span className="tab-sample-more">
                          {t.splitModal.previewMoreTabs.replace('{count}', String(chunk.length - 2))}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="split-modal-footer">
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
              disabled={busy || childCount === 0 || totalTabs === 0}
            >
              <Icon name="split" size={14} />
              <span>
                {busy
                  ? t.splitModal.submittingBtn
                  : t.splitModal.submitBtn.replace('{count}', String(childCount))}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
