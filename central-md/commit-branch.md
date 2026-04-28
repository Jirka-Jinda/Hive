---
name: Commit reviewed branch
description: Review a branch with a subagent, fix the findings, then commit and push the result.
params:
  - name: repo
    type: repo
    description: Repository that contains the branch you want to finish.
  - name: branch
    type: text
    description: Branch that should be reviewed, fixed, committed, and pushed.
  - name: base_branch
    type: text
    default: "main"
    description: Base branch used when reviewing the branch diff.
  - name: remote
    type: text
    default: "origin"
    description: Remote that should receive the final push.
---

Work in `{{repo}}` and finish branch `{{branch}}`.

1. Make sure the repository is on `{{branch}}`. If it is not, switch to that branch before doing anything else.
2. Immediately launch a `code-review` subagent for `{{branch}}` against `{{base_branch}}`. Ask it for a thorough review of the branch diff and any staged or unstaged changes, with focus on correctness, regressions, missing validation, unsafe behavior, and anything that should block a commit.
3. Wait for the review result and bring every actionable finding back into your own work. Fix the issues on `{{branch}}` instead of stopping at the review summary.
4. Run the relevant checks for the code you changed. If more issues appear, fix them before continuing.
5. If no changes remain to commit after the fixes, stop and say that clearly instead of creating an empty commit.
6. Once the branch is ready, create a single non-amended commit on `{{branch}}` with a concise message that matches the actual changes.
7. Push the commit to `{{remote}}` on `{{branch}}`. If the branch does not have an upstream yet, set it as part of the push.
8. Finish only after the review findings are addressed and the push succeeds. If you are blocked, explain the exact blocker and do not claim success.
