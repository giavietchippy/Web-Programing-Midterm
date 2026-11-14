# Member 3 – Hướng dẫn hoàn tất Docker + TURN + Nginx HTTPS

> Bản vá này được thiết kế cho ZIP `Web-Programing-Midterm.zip` đã gửi ngày 14/11/2026. Dùng trên nhánh `Ann`. **Không** bao gồm `.env`, database thật, `.git`, private key hay `node_modules`.
>
> Đã test: `integration-test.cjs`, `session-version-test.cjs`, `turn-config-test.cjs`. **Chưa test được Docker container, HTTPS trong browser hoặc TURN relay thật** trên máy của bạn; bắt buộc chạy các bước 5–7.

## 1. Ba lỗi trong ảnh đã xử lý thế nào?

| Lỗi | Cách xử lý trong code | Kiểm tra |
|---|---|---|
| `/api/config/ice` trả `turns:` port 5349 dù coturn không có TLS | `Source code/platform/server.js` chỉ trả `turn:` UDP/TCP 3478 mặc định; `TURN_TLS_ENABLED=false` | `node scripts/turn-config-test.cjs`; xem JSON `/api/config/ice` |
| TURN_SECRET giữa Platform và coturn không giống | Root `docker-compose.yml` lấy **cùng** `${TURN_SECRET}` từ **một** `.env` cho cả Platform và coturn | Script preflight + test relay `candidateType: relay` |
| Chưa có Dockerfile/Compose/Nginx/HTTPS | Bổ sung Dockerfile Platform/Real-time, `docker-compose.yml` root, Nginx gateway HTTPS, script sinh cert dev | `docker compose config`, `docker compose up -d --build`, mở website HTTPS |

Đồng thời tích hợp bản vá JWT `sessionVersion` cũ và hiển thị checkbox `Force TURN relay` ở Frontend chế độ API thật.

## 2. Chép bản vá vào clone trên nhánh Ann

**Dừng** 3 server `node`/Vite đang chạy trước; không xóa database SQLite cũ. Mở VS Code PowerShell tại gốc repo:

```powershell
git switch Ann
git status
```

Nếu có thay đổi chưa commit, hãy commit/stash trước. Nếu dùng gói `member3_complete_deployment_patch.zip`:

```powershell
$zip = "$env:USERPROFILE\Downloads\member3_complete_deployment_patch.zip"
$tmp = Join-Path $env:TEMP 'member3_complete_deployment_patch'
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$tmp\apply_member3_full_patch.ps1" -Repo (Get-Location).Path
```

Script tạo bản backup các file bị ghi đè trong `%TEMP%`, chỉ chép code/config/documentation, **không** chạm `.env`, database hay `.git`.

## 3. Chuẩn bị Docker Desktop

1. Cài và bật Docker Desktop (Linux containers, WSL 2 trên Windows).
2. Kiểm tra:

```powershell
docker --version
docker compose version
docker info
```

Nếu `docker info` báo không kết nối được daemon, mở Docker Desktop trước.

## 4. Sinh một `.env` chung để không lệch secret

Ở gốc repository:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-env.ps1
```

Nếu gốc đã có `.env`, script sẽ **không ghi đè**. Khi đó hãy sao lưu nó và cập nhật thủ công theo `.env.example` mới.

Mở `.env` ở **gốc repo** (không phải `platform/.env` hay `realtime/.env`). Ba biến này có **3 giá trị khác nhau** và được sinh ngẫu nhiên:

```env
JWT_SECRET=<random-number-1>
INTERNAL_API_KEY=<random-number-2>
TURN_SECRET=<random-number-3>
```

Điền tiếp hai giá trị cần thiết (không giữ `REPLACE_WITH_...`):

```env
TURN_HOST=192.168.1.50
TURN_EXTERNAL_IP=192.168.1.50
```

- `192.168.1.50` **chỉ là ví dụ**. Trên Windows, chạy `ipconfig` xem **IPv4 Address** của Wi-Fi/Ethernet rồi dùng IP thật của máy Docker cho bài test cùng mạng LAN. Với VPS, dùng public IPv4 của máy (hoặc tên miền phân giải về IP đó cho `TURN_HOST`).
- Browser phải truy cập được `TURN_HOST:3478` và dải UDP `49160–49200`; **không** dùng `TURN_HOST=coturn` (chỉ container biết hostname đó).
- Khi chạy máy Windows với Docker Desktop, việc chuyển tiếp UDP qua nhiều lớp NAT có thể khiến TURN relay không hoạt động dù cấu hình đúng. Nếu thất bại, thử trên VPS Linux có public IP, `--network=host` cho coturn, hoặc kiểm tra NAT/firewall.
- `TURN_SECRET` trong root `.env` tự được Docker Compose cấp giống nhau cho `platform` và `coturn`. **Không chỉnh hai secret riêng rẽ**.
- Giữ `TURN_TLS_ENABLED=false`. HTTPS website là TLS của Nginx, **khác** TURN TLS port 5349.

`ADMIN_PASSWORD` đã được script tự sinh, lấy giá trị trong root `.env` để đăng nhập admin. Không đăng bí mật, chụp screenshot hoặc commit `.env`.

## 5. Tạo HTTPS self-signed cho demo local

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\generate-local-cert.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-deployment-config.ps1
```

Lệnh đầu sử dụng Docker + OpenSSL tạo hai file *chỉ trong máy bạn*:

```
deploy/certs/fullchain.pem
deploy/certs/privkey.pem
```

Hai file đã bị `.gitignore` loại trừ. Cert local có hạn 7 ngày và chỉ cho `localhost`; browser sẽ cảnh báo vì self-signed. Đây là **môi trường DEMO**, không phải chứng chỉ đáng tin cho domain công khai. Khi triển khai thật, thay bằng chứng chỉ CA hợp lệ của domain (ví dụ Let's Encrypt) và chạy cổng 80/443.

## 6. Khởi động một lệnh

Chạy từ **gốc repo** (không vào `Source code/frontend`):

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 platform realtime coturn gateway frontend
```

Website: **https://localhost:8443**. `http://localhost:8080` sẽ chuyển hướng sang HTTPS.

Services trong Compose: `platform:3000`, `realtime:3001`, `frontend:80` chỉ truy cập nội bộ Docker; `gateway` xuất HTTPS 8443; `coturn` xuất TCP/UDP 3478 và UDP 49160–49200.

Nếu trước đó vẫn còn Node/Vite local trên cổng 3000/3001/5173 thì không xung đột với Compose vì các backend không mở cổng ra host. Cần đảm bảo 8080/8443/3478/49160–49200 không bị chiếm.

## 7. Checklist kiểm thử trước khi nộp

**A. Backend (chạy local từ `Source code` với npm dependency Realtime đã cài):**

```powershell
cd 'Source code'
npm.cmd --prefix .\realtime ci
node .\scripts\integration-test.cjs
node .\scripts\session-version-test.cjs
node .\scripts\turn-config-test.cjs
cd ..
```

Cả ba nên có dòng `PASS` cuối; script chỉ khẳng định logic backend, **không** khẳng định coturn thực sự relay.

**B. Gateway/Nginx/HTTPS:**

- Mở `https://localhost:8443`, đăng nhập admin với mật khẩu trong root `.env`.
- Mở Chrome DevTools → Network: đăng nhập phải trả 200; thử GET `/api/me` khi chưa đăng nhập trả 401; `/internal/...` và `/dev/token` qua gateway phải không truy cập được.
- Tạo phòng, tham gia bằng tài khoản thứ hai (cửa sổ ẩn danh), gửi chat qua Server, rời vào lại, kiểm tra lịch sử.
- Admin Block người dùng đang gọi video: socket cũ bị ngắt và REST token cũ bị từ chối.

**C. TURN relay (quan trọng nhất với ảnh nhóm gửi):**

1. Đăng nhập; ở Lobby bật **Force TURN relay** và sau đó mới Join phòng.
2. Trong DevTools → Network → `GET /api/config/ice`, kiểm tra `iceServers` có `turn:<YOUR_HOST>:3478?transport=udp` và `?transport=tcp`, **không có** `turns:...:5349`.
3. Mở 2 cửa sổ/browser hoặc 2 thiết bị, tham gia cùng phòng. Trong tab **ICE debug/Stats**, phải thấy `candidateType: relay` hoặc selected candidate pair dùng relay, đồng thời `connectionState=connected` và video/audio chạy.
4. Nếu `relay` không xuất hiện hoặc call không kết nối, chạy `docker compose logs --tail=100 coturn`, kiểm tra IP host thực, Windows Firewall/router/VPS firewall (3478 TCP/UDP, 49160–49200 UDP), đừng báo PASS khi chưa test đạt.
5. Hãy chụp bằng chứng: JSON ICE (ẩn username/credential), tab Stats/ICE có relay, cuộc gọi 2 peer, `docker compose ps`.

**D. Database:** `docker compose restart platform` rồi đăng nhập lại; room và user vẫn còn (volume `platform-data`). Không chạy `docker compose down -v` nếu muốn giữ dữ liệu.

## 8. HTTPS thật để nộp demo online

- Có domain trỏ về VPS public IP và mở inbound `80/tcp`, `443/tcp`, `3478/tcp`, `3478/udp`, `49160:49200/udp`.
- Xin chứng chỉ TLS hợp lệ (Let's Encrypt/CA), đặt `fullchain.pem` và `privkey.pem` vào `deploy/certs/` trên server. Giữ key riêng tư.
- Sửa root `.env`: `HTTP_PORT=80`, `HTTPS_PORT=443`, `TURN_HOST=public-hostname-or-IP`, `TURN_EXTERNAL_IP=PUBLIC_IPV4`.
- Dùng `docker compose up -d --build`; mở `https://your-domain` và kiểm tra 2 thiết bị ở 2 mạng.
- Nếu có Cloudflare/LB phía trước, cấu hình trusted IP đúng trước khi dùng `X-Forwarded-For`; không tin header tự khai từ Internet.
- Trong bản Compose này coturn **không** bật TURN/TLS port 5349. Có thể demo TURN UDP/TCP 3478, nhưng một số mạng chỉ cho TLS/443 sẽ cần công việc bổ sung: cert riêng cho coturn, cấu hình TLS, và URL `turns:` sau khi chạy được.

Không thể tự tạo một domain/VPS/chứng chỉ CA hợp lệ chỉ từ source code. Do đó bản vá có **cấu hình triển khai đầy đủ** nhưng việc deploy lên máy có public IP và test relay là bước bạn cần thực hiện trên hạ tầng thật.

## 9. Gửi code lên GitHub

```powershell
git status
git diff --check
git add docker-compose.yml .env.example .gitignore DEPLOY_MEMBER3_GUIDE.md deploy scripts 'Source code'
git diff --cached --name-only
```

**Dừng trước khi commit nếu thấy** `.env`, `.pem`, `.key`, `platform.sqlite`, `node_modules`, `.git` hay secret. Sau đó:

```powershell
git commit -m 'feat: add coturn and full-app HTTPS Docker deployment'
git push origin Ann
```

## 10. Tổng kết trạng thái trung thực

- Có code cấu hình cho Nginx HTTPS, Compose 5 services, Platform ICE không thêm TLS 5349 sai, dùng chung TURN secret với coturn.
- Đã chạy PASS test logic JWT, Room, Chat, Revoke, TURN REST credential trên môi trường kiểm tra.
- Chưa thực thi Docker Compose hoặc kiểm chứng được TURN relay trong container tại môi trường tạo bản vá; làm theo mục 6–7 trên máy bạn.
- Nếu bạn phải nộp ngay: chụp ảnh `docker compose ps`, HTTPS website, room/video 2 peer, Admin Block và ICE debug `relay` **sau khi chính bạn kiểm tra thành công**.
