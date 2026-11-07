---
description: Pick up a task ID from the build ledger — read the required docs, check the branch, claim the task and propose a plan.
argument-hint: <TASK-ID or short description>
---

Start work on: **$ARGUMENTS**

Follow these steps in order. Do not write application code until step 6.

1. Run `git status`, `git branch --show-current` and `git log --oneline -5`. If there are uncommitted changes you did not make, stop and ask before touching them.
2. Read `docs/BUILD_LEDGER.md` completely. Find the row for this task. If it does not exist, say so and propose a new task ID and row before continuing. If its status is `blocked`, check its dependencies and report what is missing.
3. Read `docs/BUILD_BRIEF.md` and the parts of `docs/VISION.md` that cover this task (its step, gate, hard rules and the §10 operating rules). Then read the sections of `docs/ARCHITECTURE_BLUEPRINT.md` and `docs/SYSTEM_ARCHITECTURE.md` for this domain and the shared contracts it touches; say which sections you read.
4. For screens, read the matching sections of `docs/UI_REBUILD_SPEC.md` and `docs/OWNER_JOURNEYS.md`. Use `GREY_RETENTION_DISCOVERY.md` only as behavioral reference. Ignore `docs/archive/`.
5. If the task touches routing, server actions, caching or middleware, read the matching guide in `node_modules/next/dist/docs/`.
6. Write a short plan:
   - goal in one sentence, written for the product owner;
   - owned paths and any shared contracts you must touch (and why);
   - migrations needed, with numbers from the correct domain range;
   - tests you will add (unit, pgTAP, Playwright) covering behavior, authorization, state transitions and failure paths;
   - anything that would need a live provider, paid AI, a new dependency or a deploy — these need the owner's explicit OK.
7. Claim the task: set the ledger row's status to `in_progress` and the owner/task column to this task, and show the diff.

Then implement. Only stop for a real product decision the brief doesn't answer.
