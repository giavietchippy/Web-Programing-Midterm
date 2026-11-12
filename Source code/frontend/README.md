# WebRTC Meet – Frontend (Member 1)

Course: Web Programming & Applications (503073) – Topic 10: **WebRTC**
Stack: **React 18 + Vite 5**, served by **Nginx** in Docker.

## Quick start (for graders)

```bash
# Option A – Docker (no Node needed)
cd frontend && docker compose up --build   # open http://localhost:8080

# Option B – local dev (Node 18+; 20 recommended)
cd frontend
npm install
npm run dev                          # open http://localhost:5173
```

Mock REST accounts: `demo / demo123` and `admin / admin123`.
Two-person call on one PC: open the app in **two different tabs**, log in as `demo` in one and `admin` in the other (auth is stored per tab), then both join **demo-room**.
The camera works on `http://localhost` and on HTTPS only – plain `http://<LAN-IP>` is blocked by browsers.

---

## 1. Cấu trúc thư mục

```
frontend/                   # nằm trong Y3_Webapp_Mid/frontend
├─ README.md                # file này
├─ .env.example             # mẫu biến môi trường (dev + docker)
├─ docker-compose.yml       # service "frontend" (Member 3 có thể gộp vào compose gốc)
├─ Dockerfile               # build Vite -> Nginx
├─ nginx.conf.template      # SPA fallback + proxy /api, /ws, /realtime, /dev
├─ docker/40-runtime-config.sh   # sinh /config.js từ biến môi trường khi container chạy
├─ public/config.js         # cấu hình runtime (mock/real, WS_URL...)
├─ vite.config.js           # dev proxy /api, /ws, /realtime, /dev
└─ src/
   ├─ api/                  # endpoints.js (REST contract v1.0), errors.js, real.js, mock.js
   │   └─ admin/            # TOÀN BỘ lời gọi của khu vực /admin: real.js, mock.js, index.js, http.js
   ├─ admin/                # feed.jsx (live feed /ws/admin dùng chung), ui.jsx (hook + helper cho các trang admin)
   ├─ webrtc/
   │   ├─ RoomSession.js    # signaling WS + media + quản lý peers (không phụ thuộc React)
   │   └─ PeerLink.js       # 1 RTCPeerConnection: perfect negotiation, DataChannel, getStats
   ├─ pages/                # AuthPage (login/register), LobbyPage, RoomPage
   │   └─ admin/            # AdminLayout, Dashboard, Rooms, RoomDetail, Users, Connections, Config, Audit, Announcements
   └─ components/           # VideoTile, ControlsBar, ChatPanel, FilesPanel, StatsPanel, IcePanel, ErrorBoundary,
                            # PeoplePanel, RoomSettingsPanel, PeerManageModal, RoleBadge, Modal, admin/RoomModals
```

## 2. Cách chạy

### Dev (khuyên dùng khi code)
```bash
cd frontend && npm install && npm run dev
```
Vite proxy: `/api` → `http://localhost:3000` (Member 3); `/ws` (kể cả `/ws/admin`), `/dev` và `/realtime/*` → `http://localhost:3001` (Member 2; tiền tố `/realtime` được bỏ đi, xem mục 11).
Khác cổng: copy `frontend/.env.example` thành `frontend/.env` và sửa `DEV_API_TARGET`, `DEV_WS_TARGET`. (Chỉ có MỘT file mẫu: `frontend/.env.example`. `.env.example`, `docker-compose.yml`, `README.md` ở thư mục gốc là của cả nhóm/Member 3 – frontend không đụng tới.)

### Docker (chạy trong thư mục `frontend/`)
```bash
cd frontend
cp .env.example .env      # tuỳ chọn – mọi biến đều có mặc định
docker compose up --build
```
- Chạy ở `http://localhost:8080` (đổi bằng `FRONTEND_PORT`).
- `USE_MOCK_API=true|false` đổi **không cần build lại** (chỉ cần `docker compose up` lại): file `/config.js` được sinh lại mỗi lần container khởi động.
- `API_UPSTREAM` / `WS_UPSTREAM` là nơi Nginx chuyển tiếp `/api` và `/ws`. Mặc định trỏ `host.docker.internal` (backend chạy trên máy host). Khi gộp compose chung, đổi thành tên service, ví dụ `http://platform:3000`, `http://realtime:3001`.
- Nginx **phải resolve được** tên upstream lúc khởi động. Nếu thấy lỗi `host not found in upstream`, backend chưa chạy/đặt sai tên → dùng `depends_on` hoặc sửa biến.

## 3. Mock vs Real REST

Contract: `rest-api-contract.md` v1.0 (Member 3). `src/api/endpoints.js` liệt kê endpoint + shape response, `api/real.js` gọi backend thật, `api/mock.js` giả lập **cùng shape** bằng `localStorage` (các hàm có cùng tên/kết quả nên đổi mock <-> real không phải sửa UI).

- `USE_MOCK_API=true` (mặc định): đăng nhập/đăng ký/phòng/lịch sử chat/ICE lưu trong `localStorage`, nhưng **WebSocket vẫn là thật**. Khi đăng nhập mock, app gọi `POST /dev/token` của Member 2 để lấy **JWT ký thật**. Nếu realtime server chưa chạy, token giả bị từ chối và trang Room báo lỗi rõ ràng.
- `USE_MOCK_API=false`: gọi `/api/*` thật (Vite proxy `DEV_API_TARGET`, hoặc Nginx `API_UPSTREAM`). Đổi trong `public/config.js` (dev) hoặc biến môi trường Docker.
- Luồng vào phòng: `POST /rooms/:id/join` -> `GET /config/ice` (gọi lại mỗi lần vào phòng, không cache) -> `GET /rooms/:id/messages` -> WebSocket `join` với `room = room.id`.
- Lỗi 401 `INVALID_TOKEN` / `TOKEN_EXPIRED` tự đăng xuất để đăng nhập lại (không có refresh endpoint).
- Quy tắc nhập: username 3-32 ký tự `[A-Za-z0-9_.-]`, password 8-72 bytes (kiểm tra ở form đăng ký).

## 4. Đối chiếu với contract WebSocket/Token v1.0

| Contract | Cách frontend thực hiện |
|---|---|
| `ws://host/ws?token=<JWT>` | `buildWsUrl()` trong `config.js` (tự dùng `wss://` khi trang là HTTPS) |
| `join` → `joined` / `peer-joined` / `peer-left` | `RoomSession.onMessage` |
| Người **mới vào** là bên tạo offer; peer cũ chỉ answer | `onJoined` tạo link `initiator=true`; peer cũ tạo link khi nhận offer đầu |
| Perfect negotiation, **peerId nhỏ hơn = polite** | `PeerLink.polite`, `PeerLink.process` |
| Camera & screen là 2 `MediaStream` riêng; `media-state` | `RoomSession.toggleScreen/announceMedia`, phân loại stream theo `streamId` khi render |
| `peer-joined` → gửi lại media-state | `onMessage('peer-joined')` → `announceAll()` |
| `peer-left` → xoá mọi media state của peer | `onPeerLeft` |
| Rate limit 30 msg/s | hàng đợi gửi ~25 msg/s (`RoomSession.pump`) |
| Close code 4000/4001/4002/4003/4004/4005/4006 | `CLOSE_MESSAGES` – hiện banner + nút "Log in again/Reconnect" |
| Giới hạn người/phòng | hiển thị `x / maxPeers` theo `settings`; `ROOM_FULL` hiện thẻ giải thích + nút "Try again" |

**Chat có 2 đường** (chọn trong ô chat): *via Server (WebSocket)* theo contract (`chat` broadcast) và *via P2P (DataChannel)*. File chỉ đi qua DataChannel.

## 5. Vì sao bản cũ bị TRẮNG TRANG sau khi bật camera – và bản này tránh thế nào

Các nguyên nhân thường gặp (đã xử lý đều):
1. `navigator.mediaDevices` là `undefined` khi mở bằng `http://<IP LAN>` → code gọi `.getUserMedia` làm **crash lúc render**. Giờ có guard + thông báo rõ.
2. Gán `srcObject` khi `ref` còn `null` / trong lúc render. Giờ gán trong `useEffect`, thẻ `<video>` luôn được mount với khung 16:9 cố định.
3. Lỗi không bắt được trong render → React gỡ cả cây → trang trắng. Giờ có **`ErrorBoundary`** (hiện message + stack) và toast cho lỗi async (`unhandledrejection`). `index.html` cũng có dòng chữ "Loading app…" để biết JS có chạy không.
4. `React.StrictMode` chạy effect 2 lần → mở 2 WebSocket/2 getUserMedia. Đã bỏ StrictMode (có ghi chú trong `main.jsx`).
5. Toàn bộ logic WebRTC nằm ngoài React (`RoomSession`); lỗi ở đó chỉ hiện banner/log, không làm sập UI.

Nếu vẫn trắng: F12 → Console, rồi gửi lỗi cho mình. Đồng thời mở panel **ICE debug** (log `[webrtc]` cũng in ra Console).

## 6. Tính năng ↔ đề bài/rubric (Topic 10)

| Yêu cầu | Có trong demo |
|---|---|
| Two-tab video call | Room page, video grid tối đa 4 người |
| Signaling (SDP/ICE) | `RoomSession` ↔ Member 2 |
| STUN vs TURN fallback | Checkbox **Force TURN relay** ở Lobby (`iceTransportPolicy:'relay'`), `/config/ice` |
| Log ICE candidate & state transitions | Tab **ICE debug** + Console |
| DataChannel | Chat P2P + gửi file (chunk 16 KB, back-pressure) |
| Media tracks, `RTCPeerConnection`, DTLS-SRTP | Tab **Stats**: đường đi (host/srflx/relay), RTT, jitter, loss, fps, codec, DTLS/SRTP |
| Screen sharing + renegotiation | Nút Share screen |

Gợi ý cho **báo cáo** (đề yêu cầu tiếng Anh, 20–60 trang, nhiều hình): chụp Room 2 người, tab Stats (host vs relay), tab ICE log, sơ đồ sequence (contract đã có sẵn mermaid), sơ đồ kiến trúc 3 service. Đừng dán quá nhiều code.

## 7. Lưu ý cho Member 2 (Real-time)
- Frontend gửi `join` ngay khi WS mở; `leave` khi rời trang.
- Cần endpoint dev `POST /dev/token` (đã có trong token-contract) và `JWT_SECRET` ở local để mock login hoạt động.
- `media-state` gửi các trường `kind` (`camera`/`microphone`/`screen`), `active`, `streamId`.
- Nếu từ chối ở bước HTTP upgrade (401), trình duyệt không đọc được mã lỗi → UI chỉ hiện "Cannot reach the signaling server…". Nếu muốn UI báo đúng 4001/4002 hãy **accept rồi gửi `error` + close** như contract mô tả.

## 8. Lưu ý cho Member 3 (Platform)
- Cần: `POST /api/login` trả `{ token }` (JWT HS256 với `userId`, `username`, `iat`, `exp` 1h). Nếu response khác, sửa `api/real.js`.
- Cần `GET /api/config/ice` trả mảng `RTCIceServer` (STUN + TURN có credential theo thời gian).
- Frontend dùng cùng origin qua Nginx: `/api/*` → platform, `/ws` → realtime. Nginx của bạn có thể thay `nginx.conf.template` hoặc dùng lại 3 khối `location`.
- HTTPS là **bắt buộc** khi deploy lên domain thật (camera, `wss://`).
- Tài khoản admin/demo cần ghi trong README nộp bài (đề yêu cầu).

## 9. Trạng thái kiểm thử (trung thực)
Code này được viết trong môi trường **không có mạng** nên chưa chạy `npm install`/`build` và chưa thử trên trình duyệt thật. Hãy chạy thử 2 tab; nếu có lỗi, gửi log Console/ảnh chụp để sửa. Checklist nên test: login → vào demo-room → cho phép camera → 2 tab thấy nhau → chat WS & P2P → gửi file → share screen → Force TURN (cần coturn của Member 2) → rời phòng.

## 10. Chưa làm (chờ contract / ngoài phạm vi)
- Tự động reconnect WebSocket trong phòng (hiện có nút Reconnect thủ công; live feed của admin thì có tự reconnect).
- Tính năng P3 (phòng chờ, mật khẩu phòng) – server cũng chưa làm.

---

## 11. Chức năng chủ phòng và khu vực Administrator (`/admin`)

### 11.1 Trong phòng họp (trang `/room/:id`)
Phần quản lý chỉ **hiện** cho chủ phòng (owner) và admin; việc ẩn nút chỉ để tiện, **server mới là nơi kiểm tra quyền** mọi lệnh.

| Thành phần | Mô tả | Lệnh WebSocket |
|---|---|---|
| Huy hiệu `owner` / `admin` | Cạnh tên trên ô video, topbar, tab People. Owner xác định bằng `owner.userId`, admin bằng `role` của peer | – |
| Tab **People** | Danh sách người + menu "⋯": mute audio, stop camera, stop screen share, kick, kick & ban, make owner | `mute-peer`, `kick`, `transfer-owner` |
| Tab **Room** | Giới hạn người, khóa phòng, bật/tắt chat, chia sẻ màn hình (everyone / owner only) | `update-settings` (chỉ gửi trường đã đổi) |
| Nút **Mute all**, **End room** | Trên thanh điều khiển (và trong tab Room) | `mute-all`, `close-room` |

Sự kiện server được xử lý trong `webrtc/RoomSession.js`: `room-state` (cập nhật UI), `kicked` (rời cuộc gọi và hiện lý do), `force-mute` (tự tắt track local và báo ai yêu cầu; server không ép được trình duyệt), `room-closed`, `announcement` (toast). Mã lỗi hiển thị thông báo rõ ràng: `FORBIDDEN`, `ROOM_LOCKED`, `ROOM_FULL`, `BANNED_FROM_ROOM`, `INVALID_SETTING` (các lỗi từ chối vào phòng hiện thẻ riêng với nút "Try again").

### 11.2 Khu vực `/admin`
Chỉ hiện khi role là `admin` (ưu tiên claim `role` trong JWT, nếu không có thì dùng `user.role` của phản hồi login); người khác bị chuyển về trang chủ. Lobby có nút "Admin console" cho admin.

| Mục | Chức năng | Nguồn dữ liệu |
|---|---|---|
| Dashboard | Kết nối live, phòng, peers, messages/giây, peak, lỗi theo mã, biểu đồ live | Member 2: `GET /admin/stats` + feed `/ws/admin`; Member 3: `GET /api/admin/stats` |
| Rooms | Danh sách live, tìm kiếm, sắp xếp; đóng phòng, đổi cài đặt, thông báo | Member 2: `/admin/rooms`, `/admin/rooms/:id/settings`, `/admin/rooms/:id/close`, `/admin/announce` |
| Room detail | Người trong phòng, vai trò, trạng thái media; kick, ban, mute, chuyển owner, vào phòng | Member 2: `/admin/rooms/:id` (+ `kick`, `mute`, `transfer-owner`) |
| Users | Danh sách, tìm kiếm, tạo, đổi role, khóa/mở khóa, reset mật khẩu, xóa | Member 3: `/api/admin/users` |
| Connections | Mọi socket đang mở; ngắt kết nối, cấm N phút | Member 2: `/admin/connections`, `/admin/users/:userId/{disconnect,deny}` |
| Limits & config | maxPeersPerRoom, maxRooms, kết nối/người, rate limit, mặc định phòng mới | Member 2: `GET/PUT /admin/config` |
| Audit log | Bảng lọc theo action/phòng/user, dòng mới hiện live | Member 2: `GET /admin/audit` + feed |
| Announcements | Gửi thông báo cho mọi phòng hoặc một phòng | Member 2: `POST /admin/announce` |

**Nút Block (Users)** gọi **2 API từ một nút**: (1) Member 3 `PATCH /api/admin/users/:id {disabled:true}`, (2) Member 2 `POST /admin/users/:userId/deny {minutes}` để ngắt kết nối ngay. Unblock làm ngược lại (`PATCH {disabled:false}` rồi `DELETE /admin/users/:userId/deny`).

### 11.3 Mock vs thật cho khu vực admin
Mọi lời gọi admin nằm trong `src/api/admin/` (`real.js`, `mock.js`, `index.js` chọn bản dùng). Biến `USE_MOCK_ADMIN` (mặc định theo `USE_MOCK_API`):
- `true`: dữ liệu giả trong bộ nhớ, có live feed giả lập; user dùng chung tài khoản `localStorage` với mock login nên user tạo ở trang Users đăng nhập được. Đăng nhập `admin / admin123` để thử, không cần backend.
- `false`: gọi server thật. Đổi trong `public/config.js` (dev) hoặc biến môi trường `USE_MOCK_ADMIN` (Docker, không cần build lại).

**Đường dẫn:** `/admin` là route React nên trình duyệt gọi HTTP admin của Member 2 qua **`/realtime/admin/*`**; Vite proxy hoặc Nginx bỏ tiền tố `/realtime` rồi chuyển tới server realtime (thành `/admin/*`). Có thể đổi bằng `RT_ADMIN_BASE`. Live feed dùng `ws://host/ws/admin?token=<JWT>` (đã nằm trong proxy `/ws`).

### 11.4 Checklist tích hợp cho Member 2 (Real-time)
- [ ] `/realtime/*` được chuyển tới server realtime và bỏ tiền tố (dev: đã có trong `vite.config.js`; deploy: khối `location /realtime/` trong `nginx.conf.template`).
- [ ] `/ws/admin` đi qua cùng proxy WebSocket với `/ws` (đã nằm trong khối `location /ws`).
- [ ] Token admin có claim `role: "admin"` (dev: `POST /dev/token` với `{ "username": "...", "role": "admin" }`; mock login của frontend đã gửi sẵn `role`).
- [ ] CORS không cần thiết vì frontend cùng origin qua proxy.
- [ ] Hành động quản lý tính theo `userId` (disconnect/deny); `:userId` phải bằng `user.id` của platform.

### 11.5 Checklist tích hợp cho Member 3 (Platform)

**(a) Thêm claim `role` vào JWT.** Hai tài liệu đang mâu thuẫn: `rest-api-contract.md` v1.0 nói token **không có** role, còn `token-contract.md` v1.1 và server realtime **đọc role từ claim `role`** của JWT cho `/admin/*` và `/ws/admin`. Nếu token không có claim này, admin vẫn vào được trang `/admin` (frontend dựa vào `user.role`) nhưng dữ liệu realtime báo 403 và trong phòng họp admin không có quyền admin. Cần sửa `POST /api/login` để payload là `{ userId, username, role, iat, exp }` (`role` = `user` | `admin`, lấy từ database, vẫn HS256 + `JWT_SECRET`), rồi cập nhật contract (cần cả 3 thành viên duyệt).

**(b) Làm API `/api/admin/users`** (chưa có trong contract v1.0). Frontend đang **giả định** hình dạng sau (`src/api/admin/real.js`); nếu làm khác hãy báo để sửa cho khớp hoặc cập nhật contract. Tất cả cần `Authorization: Bearer <JWT>`, chỉ role `admin` (đọc từ database); lỗi dạng `{ "error": "CODE", "message": "..." }`.

| Method | Path | Body | Thành công |
|---|---|---|---|
| `GET` | `/api/admin/users?search=&role=` | – | `200 { "users": [user] }` |
| `POST` | `/api/admin/users` | `{ username, password, role }` | `201 { "user": user }` |
| `PATCH` | `/api/admin/users/:id` | `{ role?, disabled? }` | `200 { "user": user }` |
| `POST` | `/api/admin/users/:id/password` | `{ password }` | `200` hoặc `204` |
| `DELETE` | `/api/admin/users/:id` | – | `204` |

`user = { id, username, role, disabled, createdAt }` (không bao giờ trả mật khẩu/hash). Ghi chú:
- `GET`: `search` lọc theo username hoặc id (không phân biệt hoa thường), `role` là `user`/`admin`, không phân trang.
- `POST`: dùng lại luật validate của `/api/register`; lỗi `400 VALIDATION_ERROR`, `409 USERNAME_TAKEN`.
- `PATCH`: `disabled: true` nghĩa là **không đăng nhập được nữa**. Frontend mock dùng `403 ACCOUNT_DISABLED` cho `POST /api/login` của tài khoản bị khóa; mã lỗi này cần nhóm chốt.
- `POST .../password`: admin tự đặt mật khẩu mới (8–72 byte).
- `DELETE`: nên chặn admin tự xóa chính mình (`403 FORBIDDEN`); frontend cũng đã ẩn nút này.
- Token cũ của user bị khóa còn hạn tới 1 giờ: nên kiểm tra `disabled` ở mỗi request REST; phía realtime đã có lệnh deny (bước 2 của nút Block).

### 11.6 Cách kiểm tra khi đã tích hợp
1. Đặt `USE_MOCK_API=false` và `USE_MOCK_ADMIN=false` (`.env.example`, `public/config.js`).
2. Đăng nhập bằng tài khoản admin và mở `/admin`.
3. **Users** tải được danh sách (ý 11.5b); **Dashboard / Rooms / Connections** hiện số liệu thật chứ không báo 403 (ý 11.5a).
4. Mở hai tab (một admin, một user) vào cùng phòng và thử: kick, ban, mute, khóa phòng, End room, Block user, announcement.
