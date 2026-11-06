---
description: Close out a task — update its ledger row and append the handoff entry in the exact prescribed format.
argument-hint: <TASK-ID> [review|complete|blocked]
---

Write the handoff for: **$ARGUMENTS**

1. Make sure verification has run in this session (use `/verify` first if not). Never mark `complete` without passing evidence; use `review` if CI is still the only proof, and `blocked` if something stops progress.
2. Collect facts: `git branch --show-current`, `git log --oneline main..HEAD`, `git diff --stat main...HEAD`, and any new files in `supabase/migrations/`.
3. Update only this task's row in `docs/BUILD_LEDGER.md`: status, owner/task, verification summary, and notes.
4. If a shared contract changed (result/error/env/logging types, provider ports, job contracts, generated types, RLS helpers), add a dated bullet under **Global decisions** explaining what changed and why.
5. If a new migration was added, record it under **Migration allocation**.
6. Append an entry at the end of **Handoff log** using exactly this shape:

```text
### YYYY-MM-DD — TASK-ID — task name

- Status: review|complete|blocked
- Branch/worktree:
- Commit(s):
- Changed contracts:
- Migrations:
- Verification run:
- Known issues:
- Next consumer:
```

7. Run `pnpm exec prettier --write docs/BUILD_LEDGER.md`, show the diff, and summarize for the owner in three plain sentences: what works now, what is still simulated or unverified, and what comes next.
