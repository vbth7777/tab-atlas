# Tab Atlas

🌐 **[Website & Demo](https://vbth7777.github.io/tab-atlas-site/)**

A Chrome extension for managing large sets of browser tabs as live, named workspaces.

Each workspace owns one dedicated Chrome window. As you open, close, or reorder tabs in that window, the workspace updates itself in near real time. Switching to a workspace focuses its window instead of opening duplicates.

Tab Atlas is local-first: workspace data stays in Chrome's local extension storage. It does not upload data, save page content, retain cookies, or capture sign-in sessions.

## Features

- Turn the current window into a live, color-coded workspace from the toolbar popup.
- Automatically track tabs added, removed, moved, or updated in a workspace's window.
- Switch to a connected workspace by focusing its window; reopen a closed workspace in a fresh window of its own.
- Search saved workspaces by workspace name, tab title, hostname, or URL.
- Rename, recolor, detach, and delete workspaces; reopen individual tabs.
- Dark-first popup and full-screen dashboard, designed to scan a large tab library quickly.

## Install from a release

### Chrome
1. Download `tab-atlas-<version>-chrome.zip` from the latest GitHub Release and extract it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**, then select the extracted folder.

### Firefox (Development/Temporary)
1. Download `tab-atlas-<version>-firefox.zip` from the latest GitHub Release.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on...**
4. Select the downloaded `.zip` file.

## Development

Prerequisites: Node.js 20 or later and npm.

```bash
npm install
npm run dev
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose the `.output/chrome-mv3` folder.

## Quality checks and packaging

```bash
npm run test      # unit tests (Vitest)
npm run lint      # ESLint
npm run compile   # TypeScript type-check
npm run build     # production build + ZIP
```

`npm run build` creates the unpacked extension in `.output/chrome-mv3` and a distributable ZIP at `.output/tab-atlas-<version>-chrome.zip`.

## Project structure

```
entrypoints/
  background.ts        ← service worker: listens to Chrome tab/window events
  popup/               ← toolbar popup UI (React)
  dashboard/           ← full-screen dashboard UI (React)
src/
  domain/              ← business logic & models (Workspace, WorkspaceService)
  data/                ← persistence (repository interface + Chrome storage impl)
  shared/              ← typed message protocol between UI ↔ background
  ui/                  ← shared components, styles, hooks
```

## Architecture

- **WXT + React + TypeScript** with Chrome Manifest V3.
- The **background service worker** owns all Chrome Tabs/Windows API calls. It listens for tab and window events, debounces rapid changes, and syncs each window into its workspace.
- The **popup** and **dashboard** talk to the background through a typed message protocol — they never call Chrome APIs directly.
- A **repository interface** isolates persistence; the current implementation uses `chrome.storage.local` with atomic read-modify-write to prevent race conditions from burst events.
- Domain models are **schema-versioned** (currently v2 with auto-migration from v1), so a future sync/cloud backend can be added without rewriting UI or business logic.

## Privacy

A workspace stores only tab metadata: URL, title, hostname, favicon URL when supplied by Chrome, and timestamps. It does not store page contents, cookies, credentials, form fields, or authenticated browser sessions.

## License

This project is licensed under the [MIT License](LICENSE).

