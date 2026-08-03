# Tab Atlas — Design System

## Intent

A calm, high-density workspace library for people who routinely carry dozens of browser tabs. Each workspace is a live view of one dedicated Chrome window: opening, closing, or reordering tabs updates it automatically. Switching workspaces focuses the owning window rather than duplicating it.

## Foundations

- **Tone:** focused, editorial, practical; avoid decorative effects that compete with tab titles.
- **Typography:** Manrope for interface text; DM Mono for compact metadata, URLs, counts, and labels.
- **Surfaces (dark by default):** canvas `#111827`; popup `#0B1220`; sidebar `#152033`; raised surface `#1B2738`; hover `#223147`; selected `#1D3457`; divider `#334155`.
- **Text:** primary `#E8ECF5`; secondary `#B8C1D1`; muted `#A8B4CC`; faint `#7B879C`. These preserve WCAG AA contrast on all defined dark surfaces.
- **Primary action:** `#0F6CBD`; hover `#0958A5`; focus outline `#70A7FF`; informational surface `#152C4D` with text `#DCE8FF`.
- **Workspace colors:** indigo, sky, teal, emerald, amber, orange, rose, violet. Each color is paired with a text label and never used as the sole status indicator.

## Layout

- Dashboard: 258px library sidebar + fluid content canvas. Detail lists cap at 850px for scannability.
- Popup: 390px wide; current-window capture precedes recently saved workspaces.
- Mobile dashboard: sidebar is removed and content becomes single-column.

## Components

- **Extension icon:** master SVG lives at `assets/tab-atlas-icon.svg`; it depicts layered browser tabs with a focused atlas marker. It uses a navy surface and blue high-contrast geometry, then renders to transparent PNGs at 16, 32, 48, 96 and 128px in `public/icon/` for Chrome toolbar, extension manager and Web Store compatibility.
- Use line SVG icons from one visual family, sized consistently (16–18px).
- Buttons: 8–9px radii; solid blue is reserved for primary actions; secondary actions use visible neutral borders.
- Tab rows: favicon, title, hostname + URL, then an affordance to open the individual tab. Preserve one-line titles and URLs to support rapid scanning.
- Workspace navigation: colored vertical marker, name, tab count; selected state uses an elevated muted-blue surface and stronger text.
- Live state: every workspace shows a text badge — `LIVE` (green) when it owns an open window, `WINDOW CLOSED` (amber) when disconnected — plus a plain-text sync time. State is always spelled out in words, never signalled by colour alone.
- Destructive or window-affecting actions are labelled explicitly (`Switch to workspace`, `Open workspace`, `Detach`, `Delete`) and never hide how many tabs or windows they touch.

## Interaction & Accessibility

- All controls have keyboard focus rings and descriptive accessible names.
- Hover transitions last 200ms or less and never move layout.
- Respect `prefers-reduced-motion`.
- Keep a visible local-only privacy statement in the dashboard navigation.
