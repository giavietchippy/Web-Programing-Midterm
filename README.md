# This is the web programing midterm project

# WebRTC Meeting App

This repository contains the WebRTC meeting application for the Web Programming & Applications
midterm. Each team member owns a separate top-level folder:

| Folder      | Owner            | Responsibility                                           |
| ----------- | --------         | -------------------------------------------------------- |
| `frontend/` | Tran Do Quoc Anh | User interface and browser-side WebRTC                   |
| `realtime/` | Nguyen Gia Viet  | WebSocket signaling, rooms, presence, and chat           |
| `platform/` | Phan Hoai An     | REST API, authentication, database, TURN, and deployment |
| `docs/`     | Shared           | Contracts, setup, and project documentation              |

## Collaboration rules

- Work on a personal branch; do not commit directly to the shared default branch.
- Open a pull request for every change and request review from another team member.
- Keep changes within your owned folder. Changes to shared files or another member's folder
  require that owner's agreement.
- Treat the WebSocket and token contracts in `docs/` as frozen after the team reviews them.
  Discuss and agree on contract changes before implementation.
- Never commit `.env`, credentials, private keys, or real tokens.

## Getting started

1. Install the Node.js LTS release and npm.
2. Copy `.env.example` to `.env` and set a private random `JWT_SECRET` for local development.
3. Follow the setup instructions in each component's README as they are added.

## Development

Formatting uses Prettier. Run `npm run format:check` from this directory to check supported
source and documentation files. Component-specific lint and test commands will be documented
in their respective folders.

## Project status

The initial repository structure is in place. The team should review and agree on the contracts
in `docs/` before the signaling protocol is treated as final.


## Member 3: Full-app Docker + HTTPS + coturn

See [DEPLOY_MEMBER3_GUIDE.md](DEPLOY_MEMBER3_GUIDE.md) for Windows/Docker Desktop setup, a single `.env` for JWT/internal/TURN secrets, Nginx HTTPS and TURN relay verification. Start from repository root with `docker compose up -d --build` after setup.

## Run the full stack

1. **Prerequisites:** Install Git, Docker Desktop, and Chrome. On Windows, enable the WSL 2
   backend in Docker Desktop and make sure its engine is running. Node.js 24 is needed only if
   running the services outside Docker.
2. **Clone and check out `main`:**

   ```sh
   git clone https://github.com/giavietchippy/Web-Programing-Midterm.git
   cd Web-Programing-Midterm
   git switch main
   ```

   If running outside Docker after the `node_modules` files were removed from Git, run `npm install`
   in each of `Source code`, `Source code/frontend`, `Source code/platform`, and `Source code/realtime`.
3. **Create the root `.env`** from the repository root. On Windows, run
   `.\scripts\setup-env.ps1`; if execution is blocked, use
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-env.ps1`.
   On macOS/Linux, run `bash scripts/setup-env.sh`. Never commit or share `.env`.
4. **Set the TURN addresses** in `.env`: use the Wi-Fi/Ethernet IPv4 address for both
   `TURN_HOST` and `TURN_EXTERNAL_IP` (find it with `ipconfig` on Windows or `ip addr` on
   macOS/Linux). Never use a `172.x` WSL or Docker address.
5. **Generate the 365-day local certificate** from the repository root. This Docker command works
   on all operating systems:

   ```powershell
   docker run --rm -v "${PWD}:/repo" alpine:3.21 sh -c "apk add --no-cache openssl >/dev/null && sh /repo/scripts/generate-local-cert.sh"
   ```

   On macOS/Linux, use `$(pwd)` for the volume path:

   ```sh
   docker run --rm -v "$(pwd):/repo" alpine:3.21 sh -c "apk add --no-cache openssl >/dev/null && sh /repo/scripts/generate-local-cert.sh"
   ```

   Confirm `deploy/certs/fullchain.pem` and `deploy/certs/privkey.pem` exist. The PowerShell
   certificate script is a less-preferred alternative and creates a 7-day certificate.
6. **Build and start** from the repository root:

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

   Wait until every service is Up and the platform is healthy.
7. Open `https://localhost:8443` in Chrome and accept the self-signed certificate warning. To
   test a call, use two separate visible Chrome windows and allow camera and microphone access.
8. **Admin login:** see [Admin login](#admin-login) below.
9. **Stop** the stack with `docker compose down`.

### Troubleshooting

| Problem | What to do |
| --- | --- |
| 502 after a rebuild | Run `docker compose restart gateway`. |
| Gateway will not start | Check that `deploy/certs/fullchain.pem` and `deploy/certs/privkey.pem` exist. |
| Coturn is restarting | Run `docker compose logs coturn --tail 30`. |
| Camera is blocked | Select the lock/site-controls icon in Chrome and allow camera and microphone access. |
| Ports 8080, 8443, or 3478 are already in use | Change `HTTP_PORT` or `HTTPS_PORT` in `.env` for the gateway. Coturn's port 3478 and relay range 49160-49200 must also be free. |

## Admin login

The platform creates an admin from `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the root `.env` only
when its database has no admin account. The setup scripts set `ADMIN_USERNAME=admin` by default.
They generate a random admin password unless you provide one. To read only the password line from
your own `.env`:

```powershell
Select-String -Path .env -Pattern '^ADMIN_PASSWORD='
```

```sh
grep '^ADMIN_PASSWORD=' .env
```

A chosen password must be 8-72 UTF-8 bytes and cannot include quotes or line breaks. To change an
admin password after the database has been initialized, run `docker compose down --volumes` and
start the stack again; this deletes the persisted data.

### For graders

Run the setup script and log in with the resulting `ADMIN_USERNAME` and `ADMIN_PASSWORD` from your
private `.env`. To use a chosen demo password, replace the obvious placeholder below with a private
8-72 byte password; do not commit or share the generated `.env`.

```powershell
.\scripts\setup-env.ps1 -AdminPassword 'CHOOSE_A_PRIVATE_DEMO_PASSWORD'
```

```sh
ADMIN_PASSWORD='CHOOSE_A_PRIVATE_DEMO_PASSWORD' bash scripts/setup-env.sh
```
