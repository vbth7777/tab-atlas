<div align="center">

<img src="public/icon/128.png" alt="Tab Atlas Logo" width="80" height="80" />

# Tab Atlas (Community Edition)

A 100% local, privacy-focused browser extension that organizes tabs into live, window-bound workspaces with parent/child hierarchies and memory suspension.

[![Release](https://img.shields.io/github/v/release/vbth7777/tab-atlas?color=6366F1&label=Release)](https://github.com/vbth7777/tab-atlas/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-gray.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-brightgreen.svg)](#privacy)
[![Tests](https://img.shields.io/badge/Tests-passing-brightgreen.svg)](src/domain/workspace-service.test.ts)

</div>

---

Tab Atlas connects each browser window to a dedicated, named workspace. When you open, close, or reorder tabs, the workspace updates automatically. Switching workspaces brings its window into focus instead of reopening duplicates, and inactive tabs can be discarded or suspended to keep memory usage low.

It is local-first, requires no sign-up or servers, and stores all data securely within your browser's local extension storage.

## Features

### Workspace Management
- **Window-bound workspaces**: 1 window = 1 workspace. Open, reorder, or close tabs and the workspace state stays in sync.
- **2-level hierarchy**: Group related work into parent and child workspaces (e.g. sub-tasks or research topics).
- **Split & merge**: Split a large workspace into smaller child workspaces by tab count, or merge child workspaces back into their parent in one click.
- **Multi-tab operations**: Select multiple tabs with checkboxes to drag, move, or clean up across workspaces.
- **Search & deduplication**: Search tabs across the current workspace or the entire tree hierarchy. Find and remove duplicate tabs with one click.

### Memory & Performance
- **Native tab discarding**: Automatically discards background tabs using Chromium's native discard API to free memory (0 MB RAM) without losing tab state.
- **Mass tab drop protection**: Automatically freezes synchronization and creates emergency snapshots if background tabs close unexpectedly due to system memory pressure or OOM.
- **Tab suspender interoperability**: Compatible with tab suspender extensions (`chrome-extension://.../suspended.html`), preserving true URLs, titles, and icons.
- **Incognito support**: Launch workspaces into incognito mode with zero background RAM buildup.

> [!WARNING]
> **Important Note for Third-Party Tab Suspender Users:**
> If you use external extensions such as *The Great Suspender*, *Auto Tab Discard*, *Tab Wrangler*, or similar tab-suspension tools alongside Tab Atlas, **please ensure you disable any "Auto-close tabs" or "Close inactive tabs after X time" settings** in their options.
> When an external extension automatically closes an idle tab to save memory, Tab Atlas's real-time sync treats it as a user-initiated tab closure and removes the tab from your workspace. Tab Atlas already provides built-in native background tab discarding (0 MB RAM per background tab), so external auto-closing is unnecessary and can cause gradual tab loss.

### Storage & Privacy
- **100% local-first**: All data stays inside `chrome.storage.local`. Zero network requests, zero telemetry, and works completely offline.
- **JSON backup & restore**: Export your entire workspace tree to JSON or restore from an earlier backup anytime.
- **Tab history & recovery**: Per-workspace history log to reopen recently closed tabs or recover past window sessions.
- **i18n**: Built-in English and Vietnamese support.

## Installation

### Chrome & Edge
1. Download `tab-atlas-<version>-chrome.zip` from [Releases](https://github.com/vbth7777/tab-atlas/releases/latest) and unzip it.
2. Go to `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** (toggle in the top-right on Chrome, or left sidebar on Edge).
4. Click **Load unpacked** and select the extracted folder.
5. *(Optional)* If you want to use incognito workspaces, open extension details and toggle **Allow in Incognito**.

## Development

Requires Node.js 20+ and npm.

```bash
# Install dependencies
npm install

# Start extension in development mode (hot-reloading)
npm run dev

# Run Vitest test suite
npm test

# Type check & Lint
npm run compile
npm run lint

# Build production bundle and distribution zip
npm run build
```

The build output will be in `.output/chrome-mv3` with a zip archive in `.output/`.

## Architecture

```
entrypoints/
  background.ts          # Service worker: manages Chrome tabs/windows lifecycle & debounce sync
  popup/                 # Toolbar popup UI (React 19)
  dashboard/             # Full-screen workspace manager dashboard (React 19)
  suspended/             # Lightweight tab placeholder
src/
  domain/                # Core logic: Workspace, WorkspaceService, split/merge, history
  data/                  # Persistence: Chrome local storage repository
  shared/                # Typed message protocol between UI and background
  ui/                    # Design system tokens, reusable components, i18n
```

- **Manifest V3 + WXT**: Built on [WXT](https://wxt.dev) with React 19 and TypeScript.
- **Service Worker Core**: Background worker handles all Chrome API calls (`chrome.tabs`, `chrome.windows`) and debounces high-frequency tab events to prevent storage thrashing.
- **Decoupled UI**: The popup and dashboard communicate with the background worker exclusively via typed messaging.
- **Atomic Persistence**: Local storage uses atomic read-modify-write batches to prevent race conditions during burst tab operations.

## Privacy

Tab Atlas is strictly offline and private. It only stores tab metadata required to restore workspaces (URLs, titles, favicons, and timestamps) inside `chrome.storage.local`. It makes no external network requests and does not inspect page contents, cookies, credentials, or personal data.

## License

[MIT](LICENSE) © vbth7777
