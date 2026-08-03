import type { Workspace, WorkspaceColor } from '@/src/domain/workspace';

type IconName =
  | 'archive'
  | 'arrow-up-right'
  | 'chevron-right'
  | 'copy'
  | 'folder'
  | 'layout'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'trash'
  | 'unlink'
  | 'x';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></>,
    'arrow-up-right': <><path d="M7 17 17 7M8 7h9v9" /></>,
    'chevron-right': <path d="m9 18 6-6-6-6" />,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    folder: <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />,
    layout: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M9 9h12" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    trash: <><path d="M4 7h16M10 11v5M14 11v5M9 7l1-3h4l1 3M6 7l1 13h10l1-13" /></>,
    unlink: <><path d="M9 15 5.5 18.5a3.5 3.5 0 0 1-5-5L4 10M15 9l3.5-3.5a3.5 3.5 0 0 1 5 5L20 14" /><path d="m4 4 16 16" /></>,
    x: <path d="m6 6 12 12M18 6 6 18" />,
  };

  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function ColorPicker({ value, onChange }: { value: WorkspaceColor; onChange: (color: WorkspaceColor) => void }) {
  const colors: WorkspaceColor[] = ['indigo', 'sky', 'teal', 'emerald', 'amber', 'orange', 'rose', 'violet'];
  return <div className="color-picker" aria-label="Workspace color">{colors.map((color) => <button key={color} type="button" className={`color-dot ${color} ${value === color ? 'selected' : ''}`} title={color} aria-label={color} aria-pressed={value === color} onClick={() => onChange(color)} />)}</div>;
}

/** State is always spelled out in text, never signalled by colour alone. */
export function WorkspaceBadge({ workspace }: { workspace: Workspace }) {
  const live = workspace.live.status === 'connected';
  return <span className={`state-badge ${live ? 'is-live' : 'is-closed'}`}>
    <span className="state-dot" />
    {live ? 'LIVE' : 'WINDOW CLOSED'}
  </span>;
}
