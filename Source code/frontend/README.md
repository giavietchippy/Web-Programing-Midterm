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
├─ nginx.conf.template      # SPA fallback + proxy /api, /ws, /dev
├─ docker/40-runtime-config.sh   # sinh /config.js từ biến môi trường khi container chạy
├─ public/config.js         # cấu hình runtime (mock/real, WS_URL...)
├─ vite.config.js           # dev proxy /api, /ws, /dev
└─ src/
   ├─ api/                  # endpoints.js (REST contract v1.0), errors.js, real.js, mock.js
   ├─ webrtc/
   │   ├─ RoomSession.js    # signaling WS + media + quản lý peers (không phụ thuộc React)
   │   └─ PeerLink.js       # 1 RTCPeerConnection: perfect negotiation, DataChannel, getStats
   ├─ pages/                # AuthPage (login/register), LobbyPage, RoomPage
   └─ components/           # VideoTile, ControlsBar, ChatPanel, FilesPanel, StatsPanel, IcePanel, ErrorBoundary
```

## 2. Cách chạy

### Dev (khuyên dùng khi code)
```bash
cd frontend && npm install && npm run dev
```
Vite proxy: `/api` → `http://localhost:3000` (Member 3), `/ws` và `/dev` → `http://localhost:3001` (Member 2).
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
| Close code 4001/4002/4003/4004/4005 | `CLOSE_MESSAGES` – hiện banner + nút "Log in again/Reconnect" |
| Giới hạn 4 người/phòng | hiển thị `x / 4`; lỗi `ROOM_FULL` hiện toast |

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
- `media-state` gửi các trường `kind` (`camera`/`screen`), `active`, `streamId`.
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
- Trang admin stats (`/admin` endpoint của Member 3), tự động reconnect WebSocket (hiện có nút Reconnect thủ công).
