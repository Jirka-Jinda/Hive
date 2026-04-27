# Hive

Hive is a desktop workspace for running local coding-agent sessions against repositories with shared markdown context, saved credentials, automation tasks, and terminal streaming.

## Architecture

- `packages/frontend`: React + Vite UI for repos, sessions, markdown files, settings, and automation.
- `packages/backend`: Hono API, WebSocket endpoints, SQLite state, repo/session services, and automation scheduling.
- `packages/electron`: Electron shell that starts the backend as a utility process and loads the built frontend in release mode.
- `central-md/`: Shared markdown context files that are mirrored into the app data directory on startup.
- `install/`: PowerShell helper scripts plus release artifacts under `install/release`.

## Prompt Pipeline

- `md-context` on `session-start`: resolves linked central, repo, and session markdown files and injects them as a preamble for a new agent session.
- `session-state-watcher` on `user-input` and `agent-output`: tracks working vs idle state from PTY traffic and emits notifications for the UI.

## Common Scripts

- `npm install`: install all workspace dependencies.
- `npm run dev`: run backend and frontend in development.
- `npm run electron:dev`: run backend, frontend, and Electron together.
- `npm run build`: build frontend and backend.
- `npm run electron:pack`: create an unpacked Electron release in `install/release`.
- `npm run electron:dist`: create installer artifacts in `install/release`.
- `install/install.ps1`: install workspace dependencies and optional CLI tools.
- `install/dev.ps1`: start the dev app.
- `install/release.ps1`: build the release installer.

## Installation

- Requirements: Node.js, npm, and Windows for the Electron packaging flow used here.
- Fresh setup: run `install/install.ps1` from the repo root, or run `npm install` directly.
- Development: run `install/dev.ps1`.
- Release build: run `install/release.ps1`. Output goes to `install/release`.

## Runtime Notes

- Electron stores app data under its user data directory and the backend persists state in `app.db`.
- Production startup serves the built frontend from the backend and exposes WebSocket endpoints for terminal, shell, and notifications.
- Release builds package the backend dist, frontend dist, assets, and production `node_modules` needed at runtime.