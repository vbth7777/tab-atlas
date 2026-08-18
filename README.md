<div align="center">

<img src="public/icon/128.png" alt="Tab Atlas Logo" width="96" height="96" />

# ⚡ Tab Atlas — Community Edition

**Real-Time Browser Workspace Manager • 100% Local-First & Private • Tab Suspender & Incognito Zero-Lag**

[![Release](https://img.shields.io/github/v/release/vbth7777/tab-atlas?color=6366F1&label=Release)](https://github.com/vbth7777/tab-atlas/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-1E293B.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![Chrome](https://img.shields.io/badge/Chrome-supported-4285F4.svg)](#installation-on-google-chrome)
[![Edge](https://img.shields.io/badge/Edge-supported-0078D7.svg)](#installation-on-microsoft-edge)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Offline%20Vault-brightgreen.svg)](#privacy--local-vault)
[![Tests](https://img.shields.io/badge/Tests-22%2F22%20Passing-brightgreen.svg)](src/domain/workspace-service.test.ts)

</div>

---

## 🚀 100% Local-First. No account required. Open 50+ tabs without RAM thrashing.

> **Tab Atlas** is an open-source, local-first browser workspace manager designed for complete privacy and maximum speed. Every browser window is a **Live Workspace** that automatically tracks your active tabs and updates locally on your device without sending a single byte to external servers.

Featuring a built-in **Custom Tab Suspender**, **Workspace-Scoped Tab History**, and **Chromium Native Tab Discarding**, Tab Atlas eliminates tab-burst freezing and memory thrashing when restoring large workspaces (50–100+ tabs) in both **Normal** and **Incognito** windows.

---

## ✨ Features

- 🗂️ **Window-Bound Live Workspaces (1 Window = 1 Live Workspace)**: Each workspace is linked to a dedicated window. Switching workspaces brings its window into focus rather than opening redundant copies.
- ⚡ **Real-Time Automatic Sync**: Opening, closing, moving, or updating tabs automatically updates the workspace snapshot with smart debounce protection.
- 🕒 **Workspace-Scoped Local Tab History**: Each workspace maintains its own isolated timeline of visited pages, closed tabs, and closed window sessions.
- ↩️ **Smart Tab Recovery & Batch Undo**: Restore single tabs, one-click restore for multi-tab closures (*Close tabs to the right*), or reopen entire closed window sessions. Fully supported in Incognito mode!
- 💤 **Custom Tab Suspender (Normal Mode)**: Background tabs in restored workspaces stay suspended in an ultra-lightweight state (`suspended.html`, ~0.1 MB RAM, 0% CPU). Tabs seamlessly wake up the moment you click or switch to them (`browser.tabs.onActivated`).
- 🕶️ **Native Tab Discard (Incognito Mode)**: 1-Click launcher into Incognito mode. Discards background tab processes natively using Chromium APIs to eliminate memory lag without triggering `ERR_BLOCKED_BY_CLIENT` extension security blocks.
- 🔒 **100% Local Vault & Private**: All data is stored purely within `chrome.storage.local`. No accounts, no telemetry, no tracking, and no external servers.
- 💾 **Offline JSON Backup & Restore**: Export and import your entire workspace collection to a `.json` backup file anytime.
- 🔍 **Instant Deep Search**: Instantly filter across all saved workspaces by workspace name, tab title, domain, or full URL.
- 🎨 **Modern Dark-Mode UI**: Compact, high-density toolbar popup with Quick Undo banner, and a distraction-free full-screen dashboard with custom color tags.

---

## 📋 System Requirements

| Requirement | Specification |
|---|---|
| **Supported Browsers** | Google Chrome 109+ or Microsoft Edge 109+ |
| **Operating System** | Windows, macOS, or Linux |
| **Disk Space** | ~5 MB |
| **Internet Connection** | **None** (Works 100% Offline) |

---

## 📦 User Installation Guide

Installing manually takes only 1–2 minutes:

### Step 1 — Download the Release Package

1. Go to the [**Latest Releases**](../../releases/latest) page.
2. Under **Assets**, download `tab-atlas-0.1.4-chrome.zip`.
3. **Extract** the downloaded `.zip` file into a permanent folder on your computer (e.g., `C:\Extensions\TabAtlas`).

---

### Step 2 — Install on Google Chrome

1. Open Google Chrome and enter:
   ```
   chrome://extensions
   ```
2. Toggle on **Developer mode** in the **top-right corner**.
3. Click **Load unpacked** in the top-left corner.
4. Select the **extracted folder** from Step 1.
5. Click the puzzle icon 🧩 on the browser toolbar and **Pin** Tab Atlas for easy access.

---

### Step 3 — Install on Microsoft Edge

1. Open Microsoft Edge and enter:
   ```
   edge://extensions
   ```
2. In the left sidebar, turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the **extracted folder** from Step 1.
5. Pin the extension to your toolbar.

---

## 🛠️ Developer Setup & Build

If you want to contribute or build from source:

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18.0 or higher recommended)
- `npm` (included with Node.js)

### Clone & Install

```bash
git clone https://github.com/vbth7777/tab-atlas.git
cd tab-atlas
npm install
```

### Development Mode

Runs the extension in live development mode with hot reload:

```bash
npm run dev
```

### Production Build & Packaging

Builds the optimized bundle and creates the `.zip` archive inside `.output/`:

```bash
npm run build
```

The output zip file will be generated at:
```
.output/tab-atlas-0.1.4-chrome.zip
```

### Running Automated Tests

Run the test suite via Vitest:

```bash
npm test
```

---

## 🔒 Privacy & Local Vault

- **No Remote Calls**: Tab Atlas contains zero network requests, analytics, or remote logging.
- **Local Storage Isolation**: Workspaces and Tab History are persisted exclusively in `chrome.storage.local`.
- **Incognito Privacy**: Incognito tabs are handled in-memory and discarded natively without saving temporary tracking cookies to disk.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
