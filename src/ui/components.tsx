import type { Workspace, WorkspaceColor } from '@/src/domain/workspace';
import { translations, type AppLanguage } from '@/src/shared/i18n';

type IconName =
  | 'alert-circle'
  | 'archive'
  | 'arrow-up-right'
  | 'check'
  | 'check-check'
  | 'check-square'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'clock'
  | 'copy'
  | 'corner-down-right'
  | 'filter'
  | 'folder'
  | 'folder-plus'
  | 'git-merge'
  | 'globe'
  | 'grip-vertical'
  | 'history'
  | 'incognito'
  | 'layout'
  | 'layers'
  | 'move'
  | 'plus'
  | 'refresh'
  | 'rotate-ccw'
  | 'search'
  | 'sliders'
  | 'sparkles'
  | 'split'
  | 'square'
  | 'trash'
  | 'undo'
  | 'unlink'
  | 'x';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    'alert-circle': <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
    archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></>,
    'arrow-up-right': <><path d="M7 17 17 7M8 7h9v9" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
    'check-check': <><path d="M18 6 7 17l-5-5" /><path d="m22 10-7.5 7.5L13 16" /></>,
    'check-square': <><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    'chevron-left': <path d="m15 18-6-6 6-6" />,
    'chevron-right': <path d="m9 18 6-6-6-6" />,
    'chevron-up': <path d="m18 15-6-6-6 6" />,
    clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    'corner-down-right': <><polyline points="15 10 20 15 15 20" /><path d="M4 4v7a4 4 0 0 0 4 4h12" /></>,
    filter: <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />,
    folder: <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />,
    'folder-plus': <><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /><line x1="12" y1="10" x2="12" y2="16" /><line x1="9" y1="13" x2="15" y2="13" /></>,
    'git-merge': <><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" /></>,
    globe: <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>,
    'grip-vertical': <><circle cx="9" cy="12" r="1.5" /><circle cx="9" cy="5" r="1.5" /><circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="5" r="1.5" /><circle cx="15" cy="19" r="1.5" /></>,
    history: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>,
    incognito: <><path d="M2 10h20M6 10l2-6h8l2 6" /><circle cx="7" cy="16" r="3" /><circle cx="17" cy="16" r="3" /><path d="M10 16h4" /></>,
    layout: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M9 9h12" /></>,
    layers: <><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 12.5-9.17 4.16a2 2 0 0 1-1.66 0L2 12.5" /><path d="m22 17.5-9.17 4.16a2 2 0 0 1-1.66 0L2 17.5" /></>,
    move: <><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
    'rotate-ccw': <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    sliders: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>,
    sparkles: <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />,
    split: <><path d="M16 3h5v5M8 3H3v5" /><path d="M12 21v-8a4 4 0 0 0-4-4H3M21 9h-5a4 4 0 0 0-4 4v8" /></>,
    square: <rect x="3" y="3" width="18" height="18" rx="2" />,
    trash: <><path d="M4 7h16M10 11v5M14 11v5M9 7l1-3h4l1 3M6 7l1 13h10l1-13" /></>,
    undo: <><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></>,
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
export function WorkspaceBadge({ workspace, lang = 'en' }: { workspace: Workspace; lang?: AppLanguage }) {
  const live = workspace.live.status === 'connected';
  const isIncognito = live && Boolean(workspace.live.isIncognito);
  const t = (translations[lang] || translations.en).common;

  return (
    <span className={`state-badge ${live ? (isIncognito ? 'is-incognito' : 'is-live') : 'is-closed'}`}>
      <span className="state-dot" />
      {live ? (isIncognito ? t.liveIncognito : t.live) : t.windowClosed}
    </span>
  );
}

export function LanguageSwitcher({
  lang,
  onLanguageChange,
  variant = 'pill',
}: {
  lang: AppLanguage;
  onLanguageChange: (lang: AppLanguage) => void;
  variant?: 'pill' | 'compact';
}) {
  if (variant === 'compact') {
    return (
      <div className="lang-switcher-compact" role="group" aria-label="Language selection">
        <button
          type="button"
          className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
          onClick={() => onLanguageChange('en')}
          title="English"
          aria-pressed={lang === 'en'}
        >
          🇬🇧 EN
        </button>
        <button
          type="button"
          className={`lang-btn ${lang === 'vi' ? 'active' : ''}`}
          onClick={() => onLanguageChange('vi')}
          title="Tiếng Việt"
          aria-pressed={lang === 'vi'}
        >
          🇻🇳 VI
        </button>
      </div>
    );
  }

  return (
    <div className="lang-switcher-pill" role="group" aria-label="Language selection">
      <span className="lang-icon">
        <Icon name="globe" size={13} />
      </span>
      <button
        type="button"
        className={`lang-pill-btn ${lang === 'en' ? 'active' : ''}`}
        onClick={() => onLanguageChange('en')}
        aria-pressed={lang === 'en'}
        title="Switch to English"
      >
        <span className="flag-icon">🇬🇧</span>
        <span>English</span>
      </button>
      <span className="lang-divider">/</span>
      <button
        type="button"
        className={`lang-pill-btn ${lang === 'vi' ? 'active' : ''}`}
        onClick={() => onLanguageChange('vi')}
        aria-pressed={lang === 'vi'}
        title="Chuyển sang Tiếng Việt"
      >
        <span className="flag-icon">🇻🇳</span>
        <span>Tiếng Việt</span>
      </button>
    </div>
  );
}
