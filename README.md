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

1. Install Node.js LTS and start Docker Desktop.
2. From the repository root, create the private root `.env`:
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-env.ps1`.
   The script refuses to overwrite an existing `.env`; keep the generated `ADMIN_PASSWORD` private.
3. Generate the local certificate with
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\generate-local-cert.ps1`
   (self-signed, valid 7 days), or `sh ./scripts/generate-local-cert.sh` (self-signed, valid 365
   days). Browsers warn for self-signed certificates. The scripts refuse to overwrite existing
   certificate files.
4. Edit root `.env`: set `TURN_HOST` to a browser-reachable LAN IP or public VPS IP, never a
   container/WSL `172.x` address. Allow Coturn TCP/UDP `3478` and its UDP relay range
   `49160-49200` through the host firewall/NAT.
5. After `node_modules` was removed from Git, each developer should run `npm install` in the
   package directories they use (for example `Source code`, `Source code/frontend`, and
   `Source code/realtime`).
6. From the repository root, run `docker compose up -d --build`, then open
   `https://localhost:8443` (or the HTTPS port configured by `HTTPS_PORT` in root `.env`; default
   `8443`). Log in with `ADMIN_USERNAME` (default `admin`) and `ADMIN_PASSWORD` from root `.env`.
   The platform seeds that admin only when no admin account already exists in its database.
7. If the gateway returns 502 after a rebuild, run `docker compose restart gateway`.
8. Stop the stack with `docker compose down`.
