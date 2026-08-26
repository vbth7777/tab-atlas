import { useState, useEffect } from 'react';
import type { Workspace } from '@/src/domain/workspace';
import { buildWorkspaceTree } from '@/src/domain/workspace-service';
import { Icon } from '@/src/ui/components';
import { useI18n } from '@/src/shared/i18n';

interface MoveTabsModalProps {
  currentWorkspace: Workspace;
  allWorkspaces: Workspace[];
  selectedTabCount: number;
  onClose: () => void;
  onConfirm: (targetWorkspaceId: string) => Promise<void>;
}

export function MoveTabsModal({
  currentWorkspace,
  allWorkspaces,
  selectedTabCount,
  onClose,
  onConfirm,
}: MoveTabsModalProps) {
  const { t } = useI18n();
  const tree = buildWorkspaceTree(allWorkspaces);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, busy]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTargetId || selectedTargetId === currentWorkspace.id || busy) return;

    setBusy(true);
    try {
      await onConfirm(selectedTargetId);
      onClose();
    } catch (err) {
      console.error('Failed to move tabs:', err);
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
      aria-labelledby="move-modal-title"
    >
      <div className="move-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="dedup-modal-header">
          <div className="dedup-modal-header-info">
            <div className="dedup-modal-icon">
              <Icon name="move" size={18} />
            </div>
            <div>
              <h2 id="move-modal-title" className="dedup-modal-title">
                {t.moveModal.title.replace('{count}', String(selectedTabCount))}
              </h2>
              <p className="dedup-modal-subtitle">
                {t.moveModal.subtitle.replace('{from}', currentWorkspace.name)}
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

        <form onSubmit={handleSubmit} className="move-modal-body">
          <div className="move-workspaces-list">
            {tree.map((node) => {
              const isCurrentParent = node.workspace.id === currentWorkspace.id;
              const isParentSelected = selectedTargetId === node.workspace.id;

              return (
                <div key={node.workspace.id} className="move-tree-group">
                  {/* Parent Workspace Item */}
                  <div
                    className={`move-ws-item parent ${isCurrentParent ? 'is-disabled' : ''} ${
                      isParentSelected ? 'is-selected' : ''
                    }`}
                    onClick={() => !isCurrentParent && setSelectedTargetId(node.workspace.id)}
                  >
                    <span className={`workspace-color ${node.workspace.color}`} />
                    <div className="move-ws-info">
                      <strong>📁 {node.workspace.name}</strong>
                      <small>
                        {t.moveModal.parentInfo
                          .replace('{direct}', String(node.workspace.tabs.length))
                          .replace('{children}', String(node.totalChildCount))
                          .replace('{total}', String(node.totalTabsCount))}
                      </small>
                    </div>
                    {isCurrentParent ? (
                      <span className="current-badge">{t.moveModal.currentBadge}</span>
                    ) : isParentSelected ? (
                      <span className="selected-indicator">
                        <Icon name="check" size={14} />
                      </span>
                    ) : null}
                  </div>

                  {/* Children Items */}
                  {node.children.map((child) => {
                    const isCurrentChild = child.id === currentWorkspace.id;
                    const isChildSelected = selectedTargetId === child.id;

                    return (
                      <div
                        key={child.id}
                        className={`move-ws-item child ${isCurrentChild ? 'is-disabled' : ''} ${
                          isChildSelected ? 'is-selected' : ''
                        }`}
                        onClick={() => !isCurrentChild && setSelectedTargetId(child.id)}
                      >
                        <span className="tree-indent-line">└─</span>
                        <span className={`workspace-color ${child.color}`} />
                        <div className="move-ws-info">
                          <strong>{child.name}</strong>
                          <small>{t.moveModal.childInfo.replace('{count}', String(child.tabs.length))}</small>
                        </div>
                        {isCurrentChild ? (
                          <span className="current-badge">{t.moveModal.currentBadge}</span>
                        ) : isChildSelected ? (
                          <span className="selected-indicator">
                            <Icon name="check" size={14} />
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="dedup-modal-footer">
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
              disabled={busy || !selectedTargetId || selectedTargetId === currentWorkspace.id}
            >
              <Icon name="move" size={14} />
              <span>
                {busy
                  ? t.moveModal.submittingBtn
                  : t.moveModal.submitBtn.replace('{count}', String(selectedTabCount))}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
