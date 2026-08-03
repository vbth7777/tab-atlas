# Tab Atlas

A Chrome extension for saving, organizing, and restoring large sets of browser tabs as named workspaces.

Tab Atlas is local-first: workspace data stays in Chrome's local extension storage. It does not upload data, save page content, retain cookies, or capture sign-in sessions.

## Features

- Save all web tabs in the active window as a named, color-coded workspace.
- Optionally close saved tabs after capturing them.
- Search saved workspaces by workspace name, tab title, hostname, or URL.
- Restore a complete workspace into a new browser window, or reopen one tab at a time.
- Rename, recolor, and delete saved workspaces.
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
- The background service worker owns Chrome Tabs API calls and message handling.
- A repository interface isolates persistence; the current `ChromeLocalWorkspaceRepository` uses `chrome.storage.local`.
- Domain models are schema-versioned, making room for a future API-backed or synchronized repository without rewriting UI and business logic.

## Privacy

A workspace stores only tab metadata: URL, title, hostname, favicon URL when supplied by Chrome, and timestamps. It does not store page contents, cookies, credentials, form fields, or authenticated browser sessions.

## License

This project is currently unlicensed. Add a license before distributing it beyond private use.
