<div align="center">

# 🧭 Tab Atlas — Community Edition

**Trình quản lý Browser Workspaces thời gian thực · 100% Local-First & Bảo mật · Tab Suspender & Incognito Zero-Lag**

[![Release](https://img.shields.io/github/v/release/vbth7777/tab-atlas?color=6366F1&label=Release)](https://github.com/vbth7777/tab-atlas/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-1E293B.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![Chrome](https://img.shields.io/badge/Chrome-supported-4285F4.svg)](#cài-đặt-trên-google-chrome)
[![Edge](https://img.shields.io/badge/Edge-supported-0078D7.svg)](#cài-đặt-trên-microsoft-edge)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Offline%20Vault-brightgreen.svg)](#bảo-mật--quyền-riêng-tư)
[![Tests](https://img.shields.io/badge/Tests-20%2F20%20Passing-brightgreen.svg)](src/domain/workspace-service.test.ts)

</div>

---

## 🛡️ 100% Local-First. Không cần tài khoản. Mở hơn 50+ tab mượt mà không lo tràn RAM.

> **Tab Atlas** là giải pháp quản lý không gian làm việc (Workspaces) mã nguồn mở, hoạt động **hoàn toàn Offline** trên trình duyệt của bạn. Mỗi cửa sổ trình duyệt là một **Live Workspace** tự động lưu trữ và đồng bộ trạng thái ngay trên máy tính mà không gửi bất kỳ dữ liệu nào ra bên ngoài.

Tích hợp công nghệ **Custom Tab Suspender** và **Chromium Native Discard**, Tab Atlas giải quyết triệt để vấn đề giật lag, ngốn RAM khi khôi phục lại các workspace dung lượng lớn (50–100+ tabs) ở cả **chế độ Thường** lẫn **chế độ Ẩn danh (Incognito)**.

---

## ✨ Tính năng nổi bật

- 🗂️ **Quản lý Workspace theo cửa sổ (1 Window = 1 Live Workspace)**: Mỗi không gian làm việc gắn liền với một cửa sổ riêng biệt. Chuyển đổi workspace chỉ bằng 1 cú click (tự động focus cửa sổ đang mở thay vì mở trùng lặp).
- ⚡ **Tự động theo dõi & đồng bộ Realtime**: Thêm tab, đóng tab hay đổi thứ tự tab trong cửa sổ đều được ghi nhận ngay lập tức với cơ chế debounce chống nghẽn I/O.
- 💤 **Custom Tab Suspender (Chế độ Thường)**: Khi mở workspace lớn, các tab chạy nền được đưa vào trạng thái ngủ ngắt RAM/CPU (`suspended.html`). Chỉ khi bạn click chọn tab nào, tab đó mới tự động nạp trang web thật (`browser.tabs.onActivated`).
- 🕶️ **Incognito Native Discard (Chế độ Ẩn danh)**: Mở nhanh workspace vào cửa sổ Ẩn danh với 1-click. Tự động ngắt tiến trình renderer chạy ngầm bằng Chromium API, triệt tiêu 100% giật lag mà không bị lỗi `ERR_BLOCKED_BY_CLIENT`.
- 🔒 **Bảo mật & Riêng tư 100% (Local Vault)**: Toàn bộ dữ liệu nằm trong `chrome.storage.local`. Không yêu cầu tài khoản, không theo dõi người dùng, không có server trung gian.
- 💾 **Sao lưu & Phục hồi JSON**: Hỗ trợ Export và Import toàn bộ dữ liệu ra file `.json` dự phòng để chuyển đổi giữa các máy tính dễ dàng.
- 🔍 **Tìm kiếm toàn diện (Instant Search)**: Tìm kiếm nhanh theo tên workspace, tiêu đề tab, tên miền hoặc URL chính xác.
- 🎨 **Giao diện Dark Mode hiện đại**: Popup tiện ích nhỏ gọn và Dashboard toàn màn hình với thiết kế tối giản, trực quan, hỗ trợ gắn màu nhận diện (Indigo, Cyan, Rose, Amber, Emerald, Violet,...).

---

## 📋 Yêu cầu hệ thống

| Tiêu chí | Yêu cầu |
|---|---|
| **Trình duyệt** | Google Chrome 109+ hoặc Microsoft Edge 109+ |
| **Hệ điều hành** | Windows, macOS, hoặc Linux |
| **Dung lượng trống** | Khoảng 5 MB |
| **Kết nối mạng** | **Không cần** (Hoạt động 100% Offline) |

---

## 📦 Hướng dẫn cài đặt cho người dùng

Extension cài đặt thủ công cực kỳ dễ dàng chỉ trong 1–2 phút:

### Bước 1 — Tải bộ cài đặt

1. Truy cập trang [**Releases Mới Nhất**](../../releases/latest).
2. Tại mục **Assets**, tải file `tab-atlas-0.1.2-chrome.zip`.
3. **Giải nén** file vừa tải về một thư mục cố định trên máy (Ví dụ: `C:\Extensions\TabAtlas`).

---

### Bước 2 — Cài đặt trên Google Chrome

1. Mở Chrome, nhập vào thanh địa chỉ:
   ```
   chrome://extensions
   ```
2. Bật công tắc **Developer mode** (Chế độ cho nhà phát triển) ở **góc trên bên phải**.
3. Bấm nút **Load unpacked** (Tải tiện ích đã giải nén) ở góc trên bên trái.
4. Chọn **thư mục bạn vừa giải nén** ở Bước 1.
5. Bấm vào biểu tượng mảnh ghép 🧩 trên thanh công cụ và **Ghim (Pin)** Tab Atlas để sử dụng thuận tiện.

---

### Bước 3 — Cài đặt trên Microsoft Edge

1. Mở Edge, nhập vào thanh địa chỉ:
   ```
   edge://extensions
   ```
2. Bật công tắc **Developer mode** ở **menu bên trái**.
3. Bấm nút **Load unpacked** ở phía trên.
4. Chọn thư mục đã giải nén và hoàn tất cài đặt.

---

### Bước 4 (Tùy chọn) — Cấp quyền sử dụng trong Ẩn danh (Incognito)

Để sử dụng tính năng **Mở Workspace trong Cửa sổ Ẩn danh**:
1. Tại trang quản lý tiện ích (`chrome://extensions`), bấm nút **Details (Chi tiết)** của **Tab Atlas**.
2. Cuộn xuống và bật công tắc **Allow in Incognito (Cho phép ở chế độ ẩn danh)**.

---

## 💡 Hướng dẫn sử dụng & Mẹo nhanh

### 1. Tạo Live Workspace từ cửa sổ hiện tại
- Mở cửa sổ chứa các tab bạn muốn gom nhóm.
- Bấm vào biểu tượng **Tab Atlas** trên thanh công cụ.
- Đặt tên Workspace, chọn màu sắc và bấm **Start live workspace**.
- Cửa sổ này giờ đã trở thành Workspace trực tiếp! Mọi tab đóng/mở đều được tự động lưu.

### 2. Mở Workspace ở chế độ Ẩn danh (Incognito)
- Trên danh sách Workspace ở Popup hoặc Dashboard, bấm vào biểu tượng **Kính & Mũ Ẩn danh (🕶️)** bên cạnh workspace.
- Toàn bộ danh sách tab sẽ được mở trong cửa sổ Ẩn danh mới với cơ chế **Zero-Lag Tab Discard**.

### 3. Sao lưu và Khôi phục dữ liệu
- Bấm nút **Export JSON** trên Popup hoặc Dashboard để tải về file `.json` dự phòng.
- Khi cài lại máy hoặc đổi thiết bị, chỉ cần bấm **Import JSON** và chọn file backup để khôi phục toàn bộ.

---

## ❓ Câu hỏi thường gặp (FAQ)

<details>
<summary><b>Cơ chế Tab Suspender tiết kiệm tài nguyên như thế nào?</b></summary>

Khi bạn mở một Workspace có 50+ tab:
- **Chế độ Thường:** Tab đầu tiên được tải bình thường. 49 tab chạy nền sẽ nạp giao diện tĩnh siêu nhẹ `suspended.html` (~0.1MB RAM). Khi bạn click vào tab nào, tiện ích sẽ tự động nạp trang web thật ngay lập tức.
- **Chế độ Ẩn danh:** Mở trực tiếp URL thật và ngắt tiến trình ngầm bằng API `browser.tabs.discard`, không tiêu tốn RAM/CPU nền và không gây lỗi chặn quyền.
</details>

<details>
<summary><b>Dữ liệu của tôi được lưu ở đâu? Có gửi ra ngoài không?</b></summary>

- 100% dữ liệu được lưu cục bộ trong `chrome.storage.local` trên trình duyệt của bạn.
- Tiện ích **không gửi bất kỳ request mạng nào ra ngoài** và **tuyệt đối KHÔNG lưu cookie, lịch sử duyệt web hay mật khẩu của bạn**.
</details>

<details>
<summary><b>Nếu xóa cache trình duyệt thì Workspace có bị mất không?</b></summary>

Không. Tiện ích lưu trữ trong vùng nhớ Extension Storage chuyên biệt. Việc xóa cache hay lịch sử duyệt web thông thường không làm ảnh hưởng đến dữ liệu Workspace.
</details>

<details>
<summary><b>Tôi có thể chuyển Workspace sang máy tính khác không?</b></summary>

Có. Bạn có thể bấm nút **Export JSON** để xuất file sao lưu, sau đó dùng tính năng **Import JSON** trên máy tính mới.
</details>

---

## 🛠️ Dành cho lập trình viên (Developer Guide)

### Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| Framework Extension | [WXT Framework](https://wxt.dev) (Manifest V3) |
| UI & State | React 19, TypeScript, Vanilla CSS Design System |
| Lưu trữ | `chrome.storage.local` (Local Storage Repository) |
| Test Runner | [Vitest](https://vitest.dev) (Unit & Migration Tests) |
| Đóng gói | Vite 8, WXT Zip Runner |

### Sơ đồ kiến trúc

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

### Cài đặt môi trường & Chạy mã nguồn

```bash
# 1. Clone mã nguồn
git clone https://github.com/vbth7777/tab-atlas.git
cd tab-atlas

# 2. Cài đặt dependencies
npm install

# 3. Chạy môi trường phát triển (Live Reload)
npm run dev

# 4. Chạy bộ kiểm thử tự động
npm test

# 5. Build phiên bản phát hành (Production ZIP)
npm run build
```

---

## 📄 Giấy phép

Mã nguồn được phát hành theo giấy phép [MIT License](LICENSE).
Tự do sử dụng, chỉnh sửa và đóng góp cho cộng đồng.
