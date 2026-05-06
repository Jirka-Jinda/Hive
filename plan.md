# Plan: Next Improvements for Automation

This plan focuses only on the improvements we actually want to carry forward from the recent discussion. It also captures the reasoning behind the items that looked ambiguous or deceptively simple.

## Decisions

### 1. Real session-scoped live updates

We should do this, but the reason it was hard before is important.

It was hard when session markdown was not a first-class concept in the same model as central and repo markdown. The old shape mixed together:

- repo-scoped `md_files`
- separate worktree discovery rules
- separate session-agent-file compatibility routes
- repo-level websocket refreshes trying to stand in for session changes

That created a bad identity problem: the app could see a file on disk in a session worktree, but it was not always clear whether that file was:

- a shared repo file mirrored into the worktree
- a session-only draft
- a file that should be promoted

Now that `session` is a real `md_files.scope`, the live-update story is much simpler:

1. Backend emits a real session-scoped event, for example `md-files-changed { scope: 'session', sessionId, repoId }`.
2. Backend rediscovery updates only the affected session slice instead of overloading repo refreshes.
3. Frontend store treats `central`, `repo`, and `session` as separate slices and merges them for display.
4. Notification handling refreshes only the changed slice, so a session draft change does not force a repo-wide reload.
5. The UI can expose connection status directly: connected, reconnecting, backend unavailable.

So yes, this is still worth doing. The difference is that it is now a data-model problem with a clean solution, rather than a pile of exceptions around worktree files.

### 2. Unified Changes view

This should not replace dedicated screens.

Dedicated screens are still better for focused work:

- the editor is where you actually edit markdown
- the diff screen is where you inspect file changes in depth
- session views are where you operate on running work

The value of a Changes view is different. It acts as an overview or inbox, not as the only place you work. It should answer:

- what changed recently
- what is session-only versus shared
- what still needs a decision
- what failed or is out of sync

Recommendation:

- keep dedicated screens
- add a lightweight Changes view later as a summary surface that links into the existing screens

So this is only better if treated as a coordination layer, not as a replacement navigation model.

### 3. MD file history and restore

Add this to the plan.

Minimum useful version:

- store revisions on save
- show previous revisions in the editor
- diff current content against any revision
- restore an old revision as the current file

### 4. Context transparency

Add this to the plan.

The UI should show exactly what context was supplied to a session or automation run:

- which markdown files were included
- their scope
- their order
- token impact if available

This reduces mystery when agent behavior looks wrong.

### 5. Better move/copy semantics

This looks straightforward at first, but it is exactly where users get surprised.

The hidden problem is that these actions are not equivalent:

- editing content
- renaming a file
- moving a file between scopes
- duplicating a shared file into a session
- promoting a session draft into repo scope

They have different consequences.

Examples:

- If you open a repo-scoped file while a session is selected and press Save, you usually expect to keep editing the shared repo file, not silently fork it.
- If you want a branch-local experiment, you need an explicit duplicate action, otherwise you can accidentally change shared content.
- If a session draft is promoted, refs, projections, and other views may need to update because the file has changed from local-only to shared.

What is needed is not heavy logic, but explicit user intent in the UI and API:

- `Save` means update the current file in its current scope.
- `Duplicate to Session` means create a new session-scoped copy.
- `Move to Repo` means change the file’s scope to repo and make it shared.
- `Rename` should only rename, not also change scope.

The reason to design this carefully is not implementation difficulty. It is preventing silent scope changes that feel like bugs.

### 6. Session lifecycle polish

Add this to the plan.

Scope:

- archive or clean up stale sessions
- better branch naming defaults
- safe-close warnings for dirty worktrees
- one-click cleanup for dead sessions and abandoned worktrees

### 7. Automation observability

Add this to the plan.

Scope:

- last run, next run, duration, status
- failure reason and recent output summary
- rerun now
- disable after repeated failures

This is needed if scheduled automation is going to be trusted.

### 8. Startup and migration safety

Add this to the plan.

This is not only backend work. It should improve the UI too.

Backend responsibilities:

- readiness checks
- migration preflight and backup path where appropriate
- structured fatal startup logging
- explicit startup state instead of failing invisibly

UI responsibilities:

- show backend unavailable instead of generic proxy failure symptoms
- surface migration or startup failure status clearly
- show reconnecting and recovery state
- distinguish temporary disconnect from fatal startup failure

The value is that users stop seeing “the app feels broken” and instead see a concrete app state.

### 9. Performance work

This is not backend-only. It affects the UI directly.

Backend-facing performance work:

- narrower refreshes after notifications
- less redundant rediscovery and refetching
- cheaper history and revision queries

UI-facing performance work:

- code splitting for heavy screens
- virtualized long lists and logs
- fewer broad rerenders when one scope changes
- better perceived responsiveness when switching repos, sessions, and files

So yes, this belongs in the plan, but not before correctness and clarity work.

### 10. Team workflows

Excluded for now.

## Recommended Order

### Phase 1: Finish correctness and state clarity

1. Real session-scoped live updates
2. Startup and migration safety
3. Better move/copy semantics

Reason:

These make the current model trustworthy. Without them, the app can still feel inconsistent even if more features are added.

### Phase 2: Improve explainability and recovery

4. Context transparency
5. MD file history and restore
6. Session lifecycle polish

Reason:

These features reduce confusion and make mistakes reversible.

### Phase 3: Operational maturity

7. Automation observability
8. Performance work

Reason:

These matter more once the main flows are stable and users rely on them daily.

### Phase 4: Optional UX expansion

9. Unified Changes view as an overview surface, not a replacement screen

Reason:

This should come after the underlying signals are reliable, otherwise it becomes a noisy dashboard built on unstable semantics.

## Concrete Next Steps

### Live updates

1. Add `session` support to websocket md-file change events.
2. Refresh only the affected session slice in the frontend store.
3. Add a visible backend connection and reconnect state in the UI.

### File semantics

1. Keep explicit actions for `Save`, `Rename`, `Duplicate to Session`, and `Move to Repo`.
2. Add small confirmation or explanatory text when an action changes sharing behavior.
3. Audit any remaining compatibility routes so they cannot reintroduce old session-file mental models.

### Safety

1. Add a backend readiness endpoint or startup-state payload beyond simple health.
2. Surface fatal backend startup and migration errors in the frontend shell.
3. Add a regression test for legacy DB migration paths.

### Explainability

1. Show session context composition in the UI.
2. Add revision tracking for markdown saves.
3. Add restore and diff flows in the editor.

## Not In Scope Right Now

- Team collaboration workflows
- Shared onboarding packs
- Multi-user process features
