# Tab Atlas

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

1. Download `tab-atlas-<version>-chrome.zip` from the latest GitHub Release and extract it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**, then select the extracted folder.

## Development

Prerequisites: Node.js 20 or later and npm.

```bash
npm install
npm run dev
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose the development build folder printed by WXT.

## Quality checks and packaging

```bash
npm run test
npm run lint
npm run compile
npm run build
```

`npm run build` creates both the unpacked Chrome MV3 extension in `.output/chrome-mv3` and a distributable ZIP at `.output/tab-atlas-<version>-chrome.zip`.

## Architecture

- **WXT + React + TypeScript** with Chrome Manifest V3.
- The background service worker owns Chrome Tabs/Windows API calls, listens for tab and window events, and mirrors each window into the workspace that owns it.
- A repository interface isolates persistence; the current `ChromeLocalWorkspaceRepository` uses `chrome.storage.local` with atomic read-modify-write updates.
- Domain models are schema-versioned (v2), so a future API-backed or synchronized repository can be added without rewriting UI and business logic.

## Privacy

A workspace stores only tab metadata: URL, title, hostname, favicon URL when supplied by Chrome, and timestamps. It does not store page contents, cookies, credentials, form fields, or authenticated browser sessions.

## License

This project is currently unlicensed. Add a license before distributing it beyond private use.
