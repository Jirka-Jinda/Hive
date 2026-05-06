# Implementation Guide: Next Improvements for Automation

This document turns the four phases from `plan.md` into an implementation roadmap. It is intentionally more concrete than the plan: each phase describes the target behavior, the backend and frontend work, the order of implementation, and the exit criteria.

## Implementation Principles

Before starting any phase, keep these constraints stable:

- `central`, `repo`, and `session` remain the only user-facing markdown scopes.
- Worktree files are projections, not a separate long-term identity model.
- UI actions must map to explicit user intent. Avoid hidden scope changes.
- Validation should prefer narrow tests for touched behavior before broad builds.

## Phase 1: Correctness and State Clarity

Phase 1 includes:

1. Real session-scoped live updates
2. Startup and migration safety
3. Better move/copy semantics

### Goal

Make the current markdown model reliable in normal use. The app should stop feeling ambiguous about whether a file is shared, local to a session, or stale because the wrong slice refreshed.

### 1.1 Session-scoped live updates

#### Desired behavior

- When a session-scoped markdown file changes, only that session slice refreshes.
- Repo-scoped changes still refresh repo slices.
- Central changes still refresh central slices.
- The UI always knows whether it is connected, reconnecting, or disconnected from the backend notification channel.

#### Backend work

1. Extend the md-file notification event model.
   Files likely involved:
   - `packages/backend/src/services/notification-bus.ts`
   - `packages/backend/src/ws/notify.ts`
   - `packages/backend/src/index.ts`

2. Update the event payload to support:
   - `scope: 'central' | 'repo' | 'session'`
   - `repoId?: number`
   - `sessionId?: number`

3. Emit session-scoped events from all session-affecting paths.
   These include:
   - session worktree rediscovery
   - create/update/delete of session-scoped markdown via `/api/mdfiles`
   - promotion or scope moves that remove a file from session scope

4. Audit repo-level fallback emissions in startup and idle-state flows.
   Any code that currently emits only `scope: 'repo'` after session worktree discovery should either:
   - emit a precise session event, or
   - emit both session and repo events when both scopes were actually changed

#### Frontend work

1. Update notification handling in:
   - `packages/frontend/src/hooks/useNotifications.ts`

2. Implement slice-specific refresh logic:
   - `scope === 'central'` refreshes only central files
   - `scope === 'repo'` refreshes only repo files for the selected repo
   - `scope === 'session'` refreshes only session files for the selected session

3. Add connection-state tracking for the notify websocket.
   Suggested states:
   - `connected`
   - `reconnecting`
   - `disconnected`
   - `backend-unavailable`

4. Surface that state in the shell, ideally in a persistent but quiet location in:
   - `packages/frontend/src/components/Layout/AppShell.tsx`

#### Validation

- Backend tests for session-scoped notification emission
- Frontend tests for session-only refresh behavior
- Manual check: change a session draft and confirm repo files do not refetch

### 1.2 Startup and migration safety

#### Desired behavior

- The backend should either start cleanly or report a concrete startup state.
- Migration failures should be explicit and visible.
- The frontend should not degrade into generic proxy or websocket noise when the backend is unavailable.

#### Backend work

1. Introduce a startup state model.
   Suggested states:
   - `starting`
   - `ready`
   - `migration-failed`
   - `fatal-error`

2. Expose a richer readiness endpoint than a simple health ping.
   Example response shape:

```json
{
  "status": "ready",
  "version": "0.4.0",
  "db": "ok",
  "migrations": "ok"
}
```

3. Wrap startup-critical operations with explicit failure capture:
   - open database
   - migrate database
   - load automation tasks
   - initialize watchers

4. Persist fatal startup details to logs when possible, but do not rely on logs as the only surface.

5. Add a regression test for legacy migration paths, especially older `md_files` schemas.

#### Frontend work

1. Check readiness explicitly on boot instead of inferring health from proxy behavior.
2. Show a real backend-unavailable state if startup failed.
3. Distinguish:
   - backend not running
   - backend starting
   - backend failed during migration
   - temporary websocket reconnect

4. Avoid showing stale editor, repo, or session data as if it were live when the backend is down.

#### Validation

- Regression test for legacy database migration
- Manual boot test with a deliberately broken DB copy
- Frontend check that startup errors render as application state, not only console errors

### 1.3 Better move/copy semantics

#### Desired behavior

The user can always tell whether they are:

- editing the current file in place
- renaming the current file
- duplicating shared content into the selected session
- moving a session draft into repo scope

#### Backend work

1. Audit the current `/api/mdfiles` contract.
   Ensure the semantics are explicit for:
   - content updates
   - rename within the same scope
   - scope changes
   - session-to-repo moves
   - repo-to-session duplication

2. If needed, split overloaded update operations into clearer endpoints or command shapes.
   For example:
   - `PUT /api/mdfiles/:id` for in-place edits and rename
   - `POST /api/mdfiles/:id/duplicate` for copy semantics
   - `POST /api/mdfiles/:id/move` for scope transitions

3. Make scope-changing operations responsible for updating projections and emitting the right notification events.

#### Frontend work

1. Keep the editor actions explicit.
   Files likely involved:
   - `packages/frontend/src/components/Editor/MdEditor.tsx`
   - `packages/frontend/src/components/Editor/MdFilePanel.tsx`

2. Review copy and move actions against these rules:
   - `Save` never changes scope by itself
   - `Rename` never changes scope by itself
   - `Duplicate to Session` always creates a new session-scoped record
   - `Move to Repo` clearly communicates that the file becomes shared

3. Add lightweight explanatory UI near scope-changing controls.
   Examples:
   - “This will make the file shared across the repo.”
   - “This creates a branch-local copy for the selected session.”

4. Remove or de-emphasize any legacy compatibility UI that preserves the old promote mental model.

#### Validation

- Focused tests around duplicate, rename, move, and save behavior
- Manual matrix:
  - edit repo file with session selected
  - duplicate repo file into session
  - move session draft to repo
  - rename session draft without changing scope

### Exit criteria for Phase 1

- Session, repo, and central updates all refresh the correct slice
- Backend connection and startup state are visible in the UI
- Legacy migration paths are covered by regression tests
- Copy, move, rename, and save semantics are explicit and predictable

## Phase 2: Explainability and Recovery

Phase 2 includes:

4. Context transparency
5. MD file history and restore
6. Session lifecycle polish

### Goal

Make the app easier to understand and safer to recover from mistakes.

### 2.1 Context transparency

#### Desired behavior

For any session or automation run, the user can see exactly what markdown context was used and why.

#### Backend work

1. Define a context snapshot payload for a session or run.
   It should include:
   - markdown file id
   - path
   - scope
   - inclusion order
   - optional token counts
   - optional source of inclusion, such as repo refs, session refs, or explicit selection

2. Expose that payload through a route or embed it in existing session detail endpoints.

3. If context is built dynamically during execution, persist the resolved snapshot so later UI views show what was actually used, not what would be used now.

#### Frontend work

1. Add a session context details surface.
   Candidate locations:
   - session detail panel
   - editor side panel
   - run history modal

2. Show:
   - included files
   - order
   - scope badge
   - token impact if available

3. Provide quick links from the context list into the editor.

#### Validation

- Verify displayed context matches the actual snapshot sent to the run
- Confirm order and scope are stable under refresh

### 2.2 MD file history and restore

#### Desired behavior

Every markdown save produces a recoverable revision history. Users can inspect diffs and restore prior content.

#### Backend work

1. Add revision storage.
   Suggested table:

```sql
md_file_revisions(
  id,
  md_file_id,
  revision_number,
  content,
  created_at,
  author_source
)
```

2. Create a revision on every save when content changes.
3. Expose routes for:
   - list revisions
   - fetch revision content
   - restore a revision

4. Keep restore behavior simple:
   - restoration writes a new current version
   - old current content becomes another revision rather than being destroyed

#### Frontend work

1. Add a revision history view in the editor.
2. Support:
   - selecting a revision
   - diffing current vs revision
   - restoring with confirmation

3. Keep the main editing flow unchanged for users who do not use history.

#### Validation

- Revision created only when content changes
- Restore creates a new current version and preserves prior history
- Editor diff view uses the correct revision content

### 2.3 Session lifecycle polish

#### Desired behavior

Users can manage stale, dead, or dirty sessions without manual filesystem cleanup.

#### Backend work

1. Define session lifecycle statuses beyond running and stopped where useful.
   Possible derived states:
   - stale
   - orphaned worktree
   - dirty worktree
   - archived

2. Add safe cleanup operations:
   - archive session metadata without deleting worktree
   - delete session and optionally delete worktree
   - cleanup abandoned managed worktrees

3. Add branch naming templates or defaults on session creation.

#### Frontend work

1. Surface dirty-worktree warnings before delete or close.
2. Add archive and cleanup actions to the session list or details.
3. Show branch origin and worktree health more clearly.

#### Validation

- Cleanup does not delete shared repo data accidentally
- Dirty warning appears only when applicable
- Archived sessions are visually distinct from active ones

### Exit criteria for Phase 2

- Users can inspect actual context composition
- Markdown revision history is available and reversible
- Session cleanup and warning flows cover common worktree failure cases

## Phase 3: Operational Maturity

Phase 3 includes:

7. Automation observability
8. Performance work

### Goal

Make the app trustworthy at scale when sessions, scheduled tasks, and markdown history grow.

### 3.1 Automation observability

#### Desired behavior

Scheduled automation is inspectable, debuggable, and recoverable from the UI.

#### Backend work

1. Expand automation task run tracking.
   Suggested fields:
   - last run start/end
   - duration
   - status
   - failure reason
   - summarized output
   - retry count

2. Add automation run history storage if current tables are too thin.

3. Expose operations for:
   - rerun now
   - pause
   - disable after repeated failures

#### Frontend work

1. Add an automation dashboard or task details view.
2. Show:
   - last run
   - next run
   - duration
   - status badge
   - failure summary
   - recent output snippet

3. Allow rerun and disable actions directly from the UI.

#### Validation

- Failed runs are visible without checking server logs
- Rerun actions update state without full page reload
- Repeated failures can transition tasks into a paused or disabled state

### 3.2 Performance work

#### Desired behavior

The app remains responsive as repos, sessions, logs, revisions, and markdown files grow.

#### Backend work

1. Reduce broad refetches after notifications.
2. Audit rediscovery frequency and scope.
3. Add indexes and efficient queries for revision history and automation logs.
4. Prefer narrow APIs that return only the slice needed by the active view.

#### Frontend work

1. Code-split heavier screens if bundle size continues to grow.
2. Virtualize long lists:
   - logs
   - revisions
   - large file lists
3. Reduce broad store replacement when only one scope or entity changed.
4. Add loading states that preserve perceived responsiveness during data refresh.

#### Validation

- Measure cold-load bundle size and route-specific load cost
- Measure file-switch latency and session-switch latency before and after optimization
- Confirm large logs and revision lists remain smooth in the UI

### Exit criteria for Phase 3

- Automation behavior is visible and manageable from the UI
- Core workflows remain responsive with realistic data volume

## Phase 4: Optional UX Expansion

Phase 4 includes:

9. Unified Changes view

### Goal

Add a summary surface that helps users orient themselves across session, repo, and markdown activity without replacing the existing focused screens.

### Desired behavior

The Changes view should answer:

- what changed recently
- which changes are session-only
- which changes became shared
- which items need attention

It should not become a second editor, a second session list, or a second diff tool.

### Backend work

1. Define a unified change feed model.
   Possible event types:
   - markdown created
   - markdown updated
   - markdown moved across scope
   - session draft promoted
   - repo diff changed
   - automation task failed

2. Add a query endpoint for recent changes, grouped by repo and session where relevant.
3. If needed, persist change events rather than reconstructing them from current state.

### Frontend work

1. Add a new overview screen that aggregates recent activity.
2. Use compact cards or rows with clear labels for:
   - scope
   - source repo or session
   - changed object
   - timestamp
   - next action

3. Each item should deep-link into the correct dedicated screen:
   - editor
   - session view
   - diff view
   - automation details

4. Keep the screen intentionally summary-oriented.
   Avoid duplicating full edit or diff capabilities there.

### Validation

- Users can move from a recent change to the correct focused screen in one click
- The change feed is not noisy or redundant with existing views
- Session-only and shared changes are clearly distinguishable

### Exit criteria for Phase 4

- The overview screen improves orientation without replacing dedicated workflows

## Recommended Implementation Sequence

If these phases are implemented as milestones, use this order inside each milestone:

1. backend model and API changes
2. notification and data-flow changes
3. frontend state integration
4. UI affordances and explanations
5. focused tests
6. build and integration validation

That order keeps the app coherent while features are partially complete.

## Final Notes

- Phase 1 should be completed before starting the Changes view.
- Phase 2 depends on the Phase 1 data model staying stable.
- Phase 3 optimization should measure current behavior first, not guess.
- Phase 4 should stay optional until the earlier phases have made the underlying signals trustworthy.
