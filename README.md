<div align="center">

<img src="public/icon/128.png" alt="Tab Atlas Logo" width="96" height="96" />

# Tab Atlas (Community Edition)

**Real-Time Browser Workspace Manager · 2-Level Workspace Tree · Multi-Tab Drag & Drop · 100% Offline & Private · Tab Suspender & Incognito Zero-Lag**

[![Release](https://img.shields.io/github/v/release/vbth7777/tab-atlas?color=6366F1&label=Release)](https://github.com/vbth7777/tab-atlas/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-1E293B.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![Chrome](https://img.shields.io/badge/Chrome-supported-4285F4.svg)](#installation-on-google-chrome)
[![Edge](https://img.shields.io/badge/Edge-supported-0078D7.svg)](#installation-on-microsoft-edge)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-brightgreen.svg)](#privacy--data-security)
[![Tests](https://img.shields.io/badge/Tests-41%2F41%20Passing-brightgreen.svg)](src/domain/workspace-service.test.ts)

</div>

---

## 🚀 Never worry about RAM spikes when opening 50+ tabs. Organize with a 2-Level Tree · 100% Local & Private.

> **Tab Atlas** transforms every browser window into an intelligent **Live Workspace**. Every tab you open, close, move, or navigate is tracked in real-time right on your computer. No accounts, no servers, no cloud tracking.

Featuring a built-in **2-Level Workspace Hierarchy**, **Smart Auto Tab Splitting**, **Multi-Tab Drag & Drop**, **Custom Tab Suspender**, and **Chromium Native Tab Discarding**, Tab Atlas eliminates tab overload, freezing, and memory thrashing when managing large workspaces (50–100+ tabs) in both **Normal** and **Incognito** windows.

---

## ✨ Key Features

- 🌳 **2-Level Workspace Hierarchy (Parent & Child Workspaces)**: Organize complex projects into clean Root Workspaces and Child Workspaces with collapsible tree navigation and total tab counters.
- ➕ **Custom Child Workspace Creation**: Create child workspaces with custom names, colors, and initial tabs selected from the parent or currently open window.
- ➗ **Smart Auto Tab Splitting**: Evenly divide tabs from a parent workspace into child workspaces based on tab count or number of groups.
- 🔗 **One-Click Merge Back to Parent**: Consolidate tabs from child workspaces back to the parent and clean up child nodes safely.
- 🎯 **Multi-Tab Drag & Drop & Bulk Moving**: Select multiple tabs with checkboxes and drag or move them between any workspaces using the floating action bar.
- 🔍 **Two-Tier Search Scope**: Toggle between searching within the current workspace (**Local**) or across the entire workspace family tree (**Tree**).
- 🧹 **Two-Tier Duplicate Tab Cleaner**: Detect and clean redundant tab URLs within a single workspace or across the entire tree hierarchy.
- 🌐 **Built-in Multilingual Support (i18n)**: Full English (Default) and Vietnamese translations with seamless live language switching.
- 🗂️ **Window-Bound Live Workspaces (1 Window = 1 Live Workspace)**: Each workspace is linked to a dedicated window. Switching workspaces brings its window into focus rather than opening redundant copies.
- ⚡ **Real-Time Automatic Sync**: Opening, closing, moving, or updating tabs automatically updates the workspace snapshot with smart debounce protection.
- 🕒 **Workspace-Scoped Tab History & Batch Recovery**: Each workspace maintains its own timeline of visited pages, closed tabs, and closed window sessions. Reopen single tabs or entire closed batches with one click.
- 💤 **Custom Tab Suspender (Normal Mode)**: Background tabs stay suspended in an ultra-lightweight state (`suspended.html`, ~0.1 MB RAM, 0% CPU) and wake up automatically when activated.
- 🕶️ **Native Tab Discard (Incognito Mode)**: 1-Click launcher into Incognito mode with native tab discarding to eliminate RAM lag.
- 🔒 **100% Offline & Private**: Zero external network requests, no telemetry, no tracking. All data is stored locally in your browser storage.
- 💾 **Offline JSON Backup & Restore**: Export and import your entire workspace collection to a `.json` backup file anytime.

---

## 📋 System Requirements

| Requirement | Specification |
|---|---|
| **Supported Browsers** | Google Chrome 109+ or Microsoft Edge 109+ |
| **Operating System** | Windows, macOS, or Linux |
| **Disk Space** | ~5 MB |
| **Internet Connection** | None required (Works 100% Offline) |

---

## 📦 User Installation Guide

Installing manually takes only 1–2 minutes:

### Step 1 — Download the Release Package

1. Go to the [**Latest Releases**](../../releases/latest) page.
2. Under **Assets**, download `tab-atlas-0.1.5-chrome.zip`.
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

### 2. Organize with Child Workspaces
- From the Dashboard or Popup, click **➕ Create Child** under any Parent Workspace.
- Pick tabs from the parent workspace or currently open window to quickly create a sub-project workspace.

### 3. Split Large Workspaces
- When a Parent Workspace gets too large, click **Split Workspace** to automatically distribute tabs into evenly sized child workspaces.

---

## 🛠️ Developer Guide

### Prerequisites
- Node.js 18+ & npm

### Development Server
```bash
npm install
npm run dev
```

### Run Unit Tests
```bash
npm test
```

### Production Build & Packaging
```bash
npm run build
```
Creates an unpacked extension bundle in `.output/chrome-mv3` and a distribution zip in `.output/tab-atlas-0.1.5-chrome.zip`.

---

## 📄 License
MIT License © 2026 [vbth7777](https://github.com/vbth7777).
