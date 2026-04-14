# Plan: AI Agent Workspace Manager

A single-user web application (deployable via Docker) that wraps CLI-based AI agents (Claude CLI, ChatGPT CLI, Copilot CLI) with a unified UI for managing repositories, sessions, credentials, and reusable markdown artifacts (skills, tools, instructions).

## Architecture Overview

```
┌─────────────────────────────────┐
│  React Frontend (Vite)          │
│  - Sidebar: repos, sessions     │
│  - Main: terminal stream + MD   │
│  - Monaco editor for .md files  │
└──────────┬──────────────────────┘
           │  WebSocket + REST
┌──────────▼──────────────────────┐
│  Node.js Backend (Hono)         │
│  - REST API (repos, sessions,   │
│    credentials, md files)       │
│  - WebSocket (PTY streaming)    │
│  - Process manager (node-pty)   │
│  - SQLite (better-sqlite3)      │
└──────────┬──────────────────────┘
           │  Spawns
┌──────────▼──────────────────────┐
│  CLI Agents (subprocesses)      │
│  - claude (Anthropic CLI)       │
│  - chatgpt (OpenAI CLI)        │
│  - gh copilot (GitHub CLI ext)  │
└─────────────────────────────────┘
```

## Decisions

- **Stack**: Node.js (Hono) + React (Vite) + SQLite (better-sqlite3)
- **CLI interaction**: Spawn subprocesses via `node-pty` for full PTY emulation
- **Streaming**: WebSocket → xterm.js in browser for live terminal output
- **Credentials**: Encrypted JSON config file (AES-256-GCM, master password derived via PBKDF2)
- **MD files**: Monaco Editor embedded in UI with live preview pane (react-markdown)
- **Repos**: Add via local path or git clone URL
- **Deployment**: Docker container (multi-stage build)
- **Auth**: None (single-user); reverse-proxy auth recommended for remote access
- **Monorepo**: Single repo, `packages/` structure (backend + frontend)

## Project Structure

```
c:\Code\Automation\
├── package.json                    # Root workspace config
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── packages/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts            # Hono app entry, HTTP + WS server
│   │   │   ├── db/
│   │   │   │   ├── schema.ts       # SQLite schema (repos, sessions, credentials, md_files)
│   │   │   │   └── migrate.ts      # Auto-migration on startup
│   │   │   ├── routes/
│   │   │   │   ├── repos.ts        # CRUD repos (add local path / git clone)
│   │   │   │   ├── sessions.ts     # List/create/delete sessions per repo
│   │   │   │   ├── credentials.ts  # CRUD credential profiles
│   │   │   │   ├── agents.ts       # List available agents, launch agent session
│   │   │   │   └── mdfiles.ts      # CRUD for .md skills/tools/instructions
│   │   │   ├── services/
│   │   │   │   ├── process-manager.ts  # node-pty spawn, lifecycle, signal handling
│   │   │   │   ├── credential-store.ts # Encrypt/decrypt credential profiles
│   │   │   │   ├── repo-manager.ts     # Git clone, path validation, repo scanning
│   │   │   │   ├── session-store.ts    # Session CRUD, output log persistence
│   │   │   │   └── mdfile-manager.ts   # Read/write .md files (per-project + central)
│   │   │   ├── ws/
│   │   │   │   └── terminal.ts     # WebSocket handler: PTY ↔ client bridge
│   │   │   └── utils/
│   │   │       ├── crypto.ts       # AES-256-GCM encrypt/decrypt, key derivation
│   │   │       └── config.ts       # App config loader (.env + defaults)
│   │   └── data/                   # SQLite DB + encrypted credentials file (gitignored)
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── components/
│           │   ├── Sidebar/
│           │   │   ├── RepoList.tsx        # List repos, add/remove
│           │   │   ├── SessionList.tsx     # Sessions for selected repo
│           │   │   └── AgentPicker.tsx     # Select agent + credential profile
│           │   ├── Terminal/
│           │   │   └── TerminalView.tsx    # xterm.js + WebSocket integration
│           │   ├── Editor/
│           │   │   ├── MdEditor.tsx        # Monaco editor for .md files
│           │   │   └── MdPreview.tsx       # react-markdown live preview
│           │   └── Layout/
│           │       └── AppShell.tsx        # Sidebar + main content layout
│           ├── hooks/
│           │   ├── useWebSocket.ts
│           │   └── useApi.ts
│           ├── api/
│           │   └── client.ts              # Typed REST client (fetch wrapper)
│           └── store/
│               └── appStore.ts            # Zustand — selected repo, session, agent state
```

## Phases & Steps

### Phase 1: Project Scaffolding
1. Initialize monorepo with npm workspaces, root `package.json`, `tsconfig.json`
2. Scaffold backend: Hono + TypeScript, `better-sqlite3`, `node-pty`, dev scripts
3. Scaffold frontend: Vite + React + TypeScript, install xterm.js, Monaco, Zustand
4. Create `Dockerfile` (multi-stage: build frontend → serve from backend) and `docker-compose.yml`
5. Create `.env.example` with config vars (PORT, DATA_DIR, MASTER_PASSWORD_HASH)

### Phase 2: Backend Core
6. Implement SQLite schema & auto-migration (`repos`, `sessions`, `session_logs`, `credentials`, `md_files` tables)
7. Implement credential store service (AES-256-GCM encrypt/decrypt, PBKDF2 key derivation from master password)
8. Implement repo manager service (validate local path, git clone, list repos)
9. Implement process manager service (spawn CLI agent via node-pty, manage lifecycle, capture output)
10. Implement WebSocket terminal bridge (PTY stdout → WS → client, client input → WS → PTY stdin)
11. Implement session store (create session tied to repo + agent, persist scrollback/output log)

### Phase 3: Backend API Routes
12. `POST/GET/DELETE /api/repos` — add (local path or git URL), list, remove repos
13. `GET/POST/DELETE /api/repos/:id/sessions` — list, create, delete sessions
14. `POST/GET/PUT/DELETE /api/credentials` — CRUD credential profiles (agent type + env vars/config)
15. `GET /api/agents` — list available agents (claude, chatgpt, copilot) with detection of installed CLIs
16. `GET/POST/PUT/DELETE /api/mdfiles` — CRUD .md files (scoped: central or per-repo)
17. `GET /api/mdfiles/:id/render` — return rendered HTML for a .md file
18. `WS /ws/terminal/:sessionId` — attach to running PTY or start new one

*Steps 12–17 are parallel with each other; step 18 depends on steps 10–11.*

### Phase 4: Frontend Shell
19. Build `AppShell` layout: collapsible sidebar (left) + main content area (right)
20. Build `RepoList` component: list repos, "Add Repo" dialog (path or git URL), delete button
21. Build `SessionList` component: show sessions for selected repo, "New Session" with agent + credential picker
22. Build `AgentPicker` component: dropdown for agent type, dropdown for credential profile

### Phase 5: Terminal & Editor
23. Build `TerminalView`: xterm.js instance, WebSocket connection to `/ws/terminal/:sessionId`, fit addon
24. Build `MdEditor`: Monaco editor instance, file tree for central + per-repo .md files
25. Build `MdPreview`: side-by-side or toggle preview using `react-markdown` + `remark-gfm`
26. Wire up routing: clicking a session opens terminal, clicking an .md file opens editor

*Steps 23–25 are parallel.*

### Phase 6: Agent Integration
27. Define agent adapter interface: `{ name, command, buildArgs(session, credential), envVars(credential) }`
28. Implement Claude CLI adapter: spawn `claude` with appropriate flags, inject API key via env
29. Implement ChatGPT CLI adapter: spawn `chatgpt` or equivalent, inject credentials
30. Implement Copilot CLI adapter: spawn `gh copilot` with GitHub token
31. Wire agent selection into session creation: chosen agent + credential → process-manager spawn

*Steps 28–30 are parallel.*

### Phase 7: MD File System (Skills/Tools/Instructions)
32. Define directory convention: `data/central/` for global .md files, `<repo-path>/.ai/` for per-repo
33. Implement backend file watcher (chokidar) to keep DB in sync with filesystem
34. Implement frontend file tree browser for both scopes
35. Support creating/editing/deleting .md files from UI with Monaco
36. When launching an agent session, allow selecting which .md files to include (passed as context/args to CLI)

### Phase 8: Docker & Deployment
37. Finalize multi-stage Dockerfile (Node 20 base, build frontend, copy to backend static serve)
38. docker-compose.yml with volume mounts for data dir and repo paths
39. Document reverse-proxy setup (Caddy/nginx) for HTTPS + optional basic auth
40. Health check endpoint `GET /api/health`

## Key Libraries

| Purpose | Library |
|---|---|
| Backend framework | `hono` + `@hono/node-server` |
| SQLite | `better-sqlite3` |
| PTY | `node-pty` |
| WebSocket (server) | `ws` |
| Frontend framework | `react` + `react-dom` |
| Build tool | `vite` |
| Terminal emulator | `@xterm/xterm` + `@xterm/addon-fit` |
| Code editor | `@monaco-editor/react` |
| MD rendering | `react-markdown` + `remark-gfm` |
| State management | `zustand` |
| Styling | `tailwindcss` |
| Crypto | Node.js built-in `crypto` module |
| Git operations | `simple-git` |
| File watching | `chokidar` |

## Database Schema (SQLite)

**repos**: `id`, `name`, `path`, `source` (local|git), `git_url`, `created_at`
**sessions**: `id`, `repo_id` (FK), `agent_type`, `credential_id` (FK), `name`, `status` (running|stopped), `created_at`, `updated_at`
**session_logs**: `id`, `session_id` (FK), `output` (blob), `created_at` — chunked terminal output for replay
**credentials**: `id`, `name`, `agent_type`, `encrypted_data` (blob), `created_at`
**md_files**: `id`, `scope` (central|repo), `repo_id` (FK, nullable), `path`, `type` (skill|tool|instruction), `created_at`, `updated_at`

## Verification

1. **Scaffolding**: `npm install` succeeds in root, `npm run dev` starts both backend + frontend with hot reload
2. **DB**: On first startup, SQLite DB is auto-created with all tables; verify with `sqlite3 data/app.db ".tables"`
3. **Repos API**: curl `POST /api/repos` with a local path → returns repo object; `GET /api/repos` lists it
4. **Credentials**: Create a credential profile → verify encrypted file is written; decrypt + re-encrypt round-trip test
5. **Terminal streaming**: Open a session in the browser → verify xterm.js shows live CLI output; type input → verify it reaches the PTY
6. **Agent launch**: Start a Claude session → verify `claude` process spawns with correct env vars and working directory set to repo path
7. **MD Editor**: Open a .md file in UI → edit in Monaco → save → verify file on disk updated; preview renders correctly
8. **Docker**: `docker build -t agent-workspace .` succeeds; `docker-compose up` → app accessible at `http://localhost:3000`

## Scope

**Included**: Core agent wrapping, session management, repo management, credential management, .md file editing, terminal streaming, Docker deployment.

**Excluded (future)**: Multi-user auth, agent-to-agent orchestration, plugin system, mobile UI, conversation history search, cost tracking, MCP server integration.

## Further Considerations

1. **Session resume**: Should reconnecting to a session replay the full terminal scrollback, or just show output from the reconnection point? *Recommendation: Store scrollback chunks, replay last N lines on reconnect.*
2. **Concurrent sessions**: Should multiple agent sessions be runnable simultaneously on the same repo? *Recommendation: Yes, allow it — the process manager tracks each independently.*
3. **CLI detection**: On startup, auto-detect which CLIs are installed and disable unavailable agents in the UI. Show installation instructions for missing ones.
