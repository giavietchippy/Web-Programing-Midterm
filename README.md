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
