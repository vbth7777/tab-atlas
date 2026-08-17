<div align="center">

<img src="public/icon/128.png" alt="Tab Atlas Logo" width="96" height="96" />

# 🧭 Tab Atlas — Community Edition

**Real-Time Browser Workspace Manager · 100% Local-First & Private · Tab Suspender & Incognito Zero-Lag**

[![Release](https://img.shields.io/github/v/release/vbth7777/tab-atlas?color=6366F1&label=Release)](https://github.com/vbth7777/tab-atlas/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-1E293B.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![Chrome](https://img.shields.io/badge/Chrome-supported-4285F4.svg)](#installation-on-google-chrome)
[![Edge](https://img.shields.io/badge/Edge-supported-0078D7.svg)](#installation-on-microsoft-edge)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Offline%20Vault-brightgreen.svg)](#privacy--local-vault)
[![Tests](https://img.shields.io/badge/Tests-20%2F20%20Passing-brightgreen.svg)](src/domain/workspace-service.test.ts)

</div>

---

## 🛡️ 100% Local-First. No account required. Open 50+ tabs without RAM thrashing.

> **Tab Atlas** is an open-source, local-first browser workspace manager designed for complete privacy and maximum speed. Every browser window is a **Live Workspace** that automatically tracks your active tabs and updates locally on your device without sending a single byte to external servers.

Featuring a built-in **Custom Tab Suspender** and **Chromium Native Tab Discarding**, Tab Atlas eliminates tab-burst freezing and memory thrashing when restoring large workspaces (50–100+ tabs) in both **Normal** and **Incognito** windows.

---

## ✨ Features

- 🗂️ **Window-Bound Live Workspaces (1 Window = 1 Live Workspace)**: Each workspace is linked to a dedicated window. Switching workspaces brings its window into focus rather than opening redundant copies.
- ⚡ **Real-Time Automatic Sync**: Opening, closing, moving, or updating tabs automatically updates the workspace snapshot with smart debounce protection.
- 💤 **Custom Tab Suspender (Normal Mode)**: Background tabs in restored workspaces stay suspended in an ultra-lightweight state (`suspended.html`, ~0.1 MB RAM, 0% CPU). Tabs seamlessly wake up the moment you click or switch to them (`browser.tabs.onActivated`).
- 🕶️ **Native Tab Discard (Incognito Mode)**: 1-Click launcher into Incognito mode. Discards background tab processes natively using Chromium APIs to eliminate memory lag without triggering `ERR_BLOCKED_BY_CLIENT` extension security blocks.
- 🔒 **100% Local Vault & Private**: All data is stored purely within `chrome.storage.local`. No accounts, no telemetry, no tracking, and no external servers.
- 💾 **Offline JSON Backup & Restore**: Export and import your entire workspace collection to a `.json` backup file anytime.
- 🔍 **Instant Deep Search**: Instantly filter across all saved workspaces by workspace name, tab title, domain, or full URL.
- 🎨 **Modern Dark-Mode UI**: Compact, high-density toolbar popup and a distraction-free full-screen dashboard with custom color tags (Indigo, Cyan, Rose, Amber, Emerald, Violet, etc.).

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
2. Under **Assets**, download `tab-atlas-0.1.3-chrome.zip`.
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
2. Toggle on **Developer mode** in the **left sidebar**.
3. Click **Load unpacked** at the top.
4. Select the extracted folder and confirm.

---

### Step 4 (Optional) — Enable Incognito Access

To allow Tab Atlas to launch workspaces into Incognito windows:
1. In `chrome://extensions`, click **Details** under **Tab Atlas**.
2. Scroll down and enable **Allow in Incognito**.

---

## 💡 Quick Start & Tips

### 1. Create a Live Workspace from Your Current Window
- Open a window with the tabs you want to save.
- Click the **Tab Atlas** icon in the toolbar.
- Give it a name, pick a color, and click **Start live workspace**.
- This window is now a connected workspace! Any tabs opened or closed are automatically tracked.

### 2. Launch Workspace into Incognito Mode
- From the popup or dashboard workspace list, click the **Incognito icon (🕶️)** next to any workspace.
- All tabs will open directly in a new Incognito window with background tabs discarded to save CPU and RAM.

### 3. Backup and Migrate Workspaces
- Click **Export JSON** on the popup or dashboard to save an offline backup file.
- On a new browser or machine, simply click **Import JSON** to restore your workspace vault.

---

## ❓ Frequently Asked Questions (FAQ)

<details>
<summary><b>How does the Tab Suspender save RAM and CPU?</b></summary>

When restoring a workspace containing 50+ tabs:
- **In Normal Mode:** The first tab loads actively. Background tabs (2..N) load a static, super-lightweight `suspended.html` page (~0.1 MB RAM). When you switch to a suspended tab, it automatically wakes up and loads the actual web page.
- **In Incognito Mode:** Opens the authentic URLs and calls `browser.tabs.discard` on background tabs immediately after navigation commits, freeing memory and CPU without triggering extension security blocks.
</details>

<details>
<summary><b>Where is my data stored? Is it private?</b></summary>

- 100% of your workspace data is stored in `chrome.storage.local` directly inside your browser.
- Tab Atlas **makes zero network requests** and **never stores cookies, form inputs, browsing history, or passwords**.
</details>

<details>
<summary><b>Will clearing browser cache delete my workspaces?</b></summary>

No. Extensions store their state in dedicated extension local storage. Clearing cache, cookies, or history will not affect your saved workspaces.
</details>

<details>
<summary><b>Can I transfer my workspaces to another computer?</b></summary>

Yes. Click **Export JSON** to download a `.json` backup file, then use **Import JSON** on your other computer to merge your workspaces.
</details>

---

## 🛠️ Developer Guide

### Tech Stack

| Component | Technology |
|---|---|
| Extension Framework | [WXT](https://wxt.dev) (Manifest V3) |
| UI & State | React 19, TypeScript, Vanilla CSS Design System |
| Local Storage | `chrome.storage.local` (Local Storage Repository) |
| Test Runner | [Vitest](https://vitest.dev) (Unit & Migration Tests) |
| Bundler & Packager | Vite 8, WXT Zip Runner |

### Architecture Overview

```
+-------------------------------------------------------------+
|                     User Interface Layer                    |
|   Popup (React)     Dashboard (React)    Suspended (HTML/TS)|
+------------------------------+------------------------------+
                               | Typed Extension Messages
                               v
+-------------------------------------------------------------+
|                 Background Service Worker                   |
|   - Window & Tab Lifecycle Listeners                        |
|   - Debounced Sync Scheduler & Window Lock                  |
|   - Native Discard & Suspender Router                       |
|   - JSON Import / Export Processing                         |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                   Domain & Data Repository                  |
|   - WorkspaceService & Migration Engine                     |
|   - ChromeLocalWorkspaceRepository (chrome.storage.local)   |
+-------------------------------------------------------------+
```

### Local Setup & Development

```bash
# 1. Clone the repository
git clone https://github.com/vbth7777/tab-atlas.git
cd tab-atlas

# 2. Install dependencies
npm install

# 3. Start development mode with hot-reload
npm run dev

# 4. Run automated unit tests
npm test

# 5. Build production extension package
npm run build
```

---

## 📄 License

Distributed under the [MIT License](LICENSE).

