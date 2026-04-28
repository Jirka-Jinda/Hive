## Plan: Session Branch Isolation

Use git worktrees for session isolation instead of switching branches in the shared repo working tree. Support branch selection only during session creation: either create a new branch with a given name or attach the session to an existing branch. After creation, git operations stay terminal-only. Add a read-only git history view in the top toolbar as an additional function, using a lightweight modal rather than a full git client UI.

**Steps**
1. Phase 1 — Persist session git metadata. Extend the `sessions` model and API payloads to carry session-specific git state: branch mode, initial branch name, and worktree path. Default non-git repos to null git metadata and preserve current behavior. This depends on updating the schema and migration path first.
2. Phase 1 — Add safe session git lifecycle operations in the backend. In `RepoManager` or a dedicated git-session service, add methods to validate branch names, list searchable local branches, detect branches already checked out in another worktree, create a worktree for a new branch from the current HEAD of the repo root worktree, attach a worktree for an existing branch, remove a worktree on session deletion, and reconcile stale worktrees on startup. This depends on step 1.
3. Phase 1 — Add locking around per-repo git mutations. Serialize create/delete/restart and branch/worktree operations for the same repo so two sessions cannot race while creating or pruning worktrees. This depends on step 2.
4. Phase 2 — Route terminal startup through the session working directory. Change session startup so the terminal WebSocket resolves the session working directory from `session.worktree_path` and only falls back to `repo.path` for non-git or legacy sessions. Update the process entry shape if needed so the active worktree path is explicit. This depends on steps 1-3.
5. Phase 2 — Make session restart/delete and repo delete worktree-aware. Restart should reuse the same worktree, session delete should kill the PTY and then remove the worktree while keeping the branch, and repo delete should lock the repo and clean up all session worktrees before removing the repo. Add startup reconciliation to prune orphaned worktrees after crashes. This depends on steps 2-4.
6. Phase 2 — Expose read-only git endpoints plus session-creation branch data. Extend repo/session routes with endpoints for searchable local branch listing, branch-in-use metadata, worktree-aware status, and simple history retrieval. Keep branch switches, rebases, merges, and other git mutations out of the UI. This depends on steps 2-5.
7. Phase 3 — Extend session creation UI for branch isolation. Update the session form to support both “new branch” and “existing branch” modes for git repos during creation only. The existing-branch picker should be searchable, local-branch-only, and show branches already in use as disabled with an explanation. Show the branch on each session row, but do not add branch editing to the existing session edit flow. This depends on steps 1-6.
8. Phase 3 — Track branch drift dynamically. Because users can run `git checkout` or similar commands in the terminal, branch badges and history context must follow the actual current branch of the session worktree rather than only the originally assigned branch. Implement this through worktree-aware status reads when the UI refreshes relevant surfaces. This depends on steps 4-6 and is parallel with step 7.
9. Phase 3 — Add a simple top-panel git history function. Add a toolbar button in the top panel that opens a lightweight modal or panel showing read-only history for the selected session worktree when a session is selected, or the selected repo root worktree otherwise. Use a simple linear commit list with commit rows, short SHA, author/time, and branch or HEAD badges instead of a heavy graph library. This depends on steps 6 and 8.
10. Phase 4 — Harden with tests and manual validation. Add backend tests for worktree create/reuse/delete/reconcile flows and history/status endpoints, plus frontend tests for session branch selection, disabled in-use branches, dynamic branch badge refresh, and the top-panel history view. Validate manual flows with two simultaneous sessions on different branches to prove edits are isolated while the history view stays read-only. This depends on steps 1-9.

**Relevant files**
- `c:\Code\Automation\packages\backend\src\db\schema.ts` — extend the `sessions` table with branch/worktree metadata.
- `c:\Code\Automation\packages\backend\src\db\migrate.ts` — add additive migration logic for existing databases.
- `c:\Code\Automation\packages\backend\src\services\session-store.ts` — return session git metadata.
- `c:\Code\Automation\packages\backend\src\services\repo-manager.ts` — reuse `simple-git` for branch/worktree/history/status operations or split those methods into a dedicated git-session service.
- `c:\Code\Automation\packages\backend\src\application\workspace-service.ts` — coordinate session creation, restart, delete, repo delete, and git-history or git-status queries.
- `c:\Code\Automation\packages\backend\src\routes\repos.ts` — extend session create routes and add read-only git endpoints.
- `c:\Code\Automation\packages\backend\src\services\process-manager.ts` — make the spawned PTY path explicitly session-specific.
- `c:\Code\Automation\packages\backend\src\ws\terminal.ts` — resolve the session working directory before PTY spawn.
- `c:\Code\Automation\packages\frontend\src\api\client.ts` — add session git metadata and git history/branch list/status endpoints.
- `c:\Code\Automation\packages\frontend\src\components\Sidebar\SessionList.tsx` — add branch mode controls to session creation and display the active session branch on session rows.
- `c:\Code\Automation\packages\frontend\src\components\Layout\AppShell.tsx` — add the top-toolbar entry point for the history view and make toolbar context session-worktree-aware.
- `c:\Code\Automation\packages\frontend\src\components\Layout\UsageModal.tsx` — useful style/reference pattern for a lightweight read-only modal surface.

**Verification**
1. Add backend Vitest coverage that creates two sessions on the same repo with different branches, confirms distinct `worktree_path` values, and proves deleting one session removes only its worktree.
2. Add backend tests that mark a branch as unavailable when it is already checked out in another worktree or the repo root worktree, and verify the UI payload exposes that disabled state.
3. Add backend restart/delete/repo-delete tests that verify PTY shutdown and worktree cleanup order, plus startup reconciliation for orphaned worktrees.
4. Add backend read-only git tests for searchable local branch listing and linear history retrieval against both selected repo state and selected session worktree state.
5. Add frontend Vitest coverage for session creation with new vs existing branch mode, disabled in-use branches, and the top-panel history modal rendering commit rows and branch badges.
6. Run a manual flow: create two sessions on one git repo, check out different branches, edit files in each, verify `git status` differs per session, and verify the main repo working tree is unchanged.
7. Run a drift flow: change branches inside the session terminal and confirm the session badge and history modal follow the actual current branch.
8. Run a history flow: with and without a selected session, open the history view and confirm it targets the session worktree when present and the repo root otherwise, while offering no mutation controls.

**Decisions**
- Use git worktrees, not shared-tree branch checkout. Shared checkout is unsafe with concurrent sessions.
- Support both branch modes during session creation: create a new branch or attach to an existing branch.
- Base new branches on the current HEAD of the repo root worktree.
- Existing-branch pickers should show searchable local branches only in v1.
- Branches already in use by another worktree should be visible but disabled with an explanation.
- Do not add UI branch switching after session creation; terminal commands remain the control surface for git operations.
- Track the actual current branch dynamically when terminal commands change it.
- Delete only the worktree on session deletion; keep the branch in the repo.
- The first extra git UI is a read-only top-panel history view with a linear commit list and branch or HEAD badges, not a sidebar widget and not a full git client.
- When a session is selected, toolbar git history and related repo-opening context should target the session worktree rather than the shared repo root.
- History should refresh on modal open and via an explicit manual refresh action, not via polling in v1.
- Non-git repos remain supported and skip the branch/worktree flow.

**Further Considerations**
1. Store worktrees under app-managed data such as `DATA_DIR/worktrees/<repoId>/<sessionId>-<branch>` rather than inside the repo working tree, so cleanup and crash recovery stay under app control.
2. Keep the first branch-creation UX simple: new branch starts from the repo root worktree’s current HEAD; defer custom base-ref selection unless users need it.
3. Keep the history modal read-only even if it later grows commit details; do not let it drift into a partial git client.