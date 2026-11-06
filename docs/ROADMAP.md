# Grey Retention roadmap

Grey Retention helps DTC and dropship brands watch 5–10 competitor brands' emails, understand their playbook, and replicate any email or sequence for their own store (**Exact**, **Rebrand** or **Adapt**), then push it to Klaviyo.

This page explains the plan in seven milestones, the order we work in, and how one piece of work goes from an issue to the live app. The detailed requirements are the 620 items in [`feature-register.json`](feature-register.json); the visual direction is [`DESIGN.md`](DESIGN.md).

## Where things live

| What                                | Where                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Every requirement and its status    | [`docs/feature-register.json`](feature-register.json) (IDs like `ONB-001`)                                   |
| Milestones, labels, issue mapping   | [`.github/project/roadmap.json`](../.github/project/roadmap.json) — edit here, not in the GitHub UI          |
| Work to do                          | [GitHub issues](https://github.com/raman-cmyk/grey-retention/issues): one per P0 item, one epic per category |
| What was built, how it was verified | [`docs/BUILD_LEDGER.md`](BUILD_LEDGER.md)                                                                    |
| Earlier delivery history            | [`docs/FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md)                                                              |

## Milestones

We finish milestones in order. Inside a milestone, **P0 issues come first**; P1/P2 items from that milestone's category epics follow when the P0 work is done.

| Order | Milestone                 | Goal (short)                                                                                                                                        | Done when                                                                                                                                                                                |
| ----- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | **M0 Stabilize**          | Background jobs run on a schedule; no developer buttons or ISO times for owners; CI on every PR; no seed accounts in production.                    | A queued job finishes on the live app without a button, no owner screen shows a test button or ISO time field, every PR has green CI, production has no `@grey-retention.test` accounts. |
| 1     | **M1 Design system**      | The new calm, editorial Grey Retention look ([DESIGN.md](DESIGN.md)) on shell, navigation, buttons, forms, cards, tables, states; the composer box. | Every screen uses the shared tokens and components, the composer exists, and screens pass AA contrast, keyboard and 375px checks.                                                        |
| 2     | **M2 Onboarding**         | Store URL → brand preview → one competitor → first useful draft, without help (ONB-001…ONB-035).                                                    | All ONB P0 items are verified, and a first-time owner gets from URL to a useful draft in one sitting.                                                                                    |
| 3     | **M3 Competitor watch**   | Add and watch brands, real email collection, honest collection states, searchable library.                                                          | An owner adds a competitor, sees its true state, and browses/filters/searches its emails with correct dates and sources.                                                                 |
| 4     | **M4 Replication engine** | Exact / Rebrand / Adapt for single emails and sequences, side-by-side compare, product mapping, locks.                                              | An owner picks an email or sequence, chooses a mode, maps products, compares side by side and gets an editable email with lineage.                                                       |
| 5     | **M5 Store + delivery**   | Shopify products/offers/ads, live Klaviyo connect, one canonical footer and stable segment names, export/schedule.                                  | With the owner's OK, a draft uses real products and offers and is exported or scheduled in Klaviyo with the right footer and audiences.                                                  |
| 6     | **M6 Intelligence**       | Observed sequences and playbooks, MCP server for other AI agents, learning loop, admin Clients/Prompt engine/Templates pages.                       | Owners see competitor playbooks with evidence, agents work through MCP with the same permissions, feedback improves drafts, admin pages work.                                            |

The full goal and "done when" text for each milestone is in `roadmap.json` and is copied into the GitHub milestone description by the sync workflow.

## Issue map

**191 issues** carry the P0 work: 179 register items plus 12 project work items (`STAB-*` for M0, `DS-*` for M1). **26 epics** ([#9](https://github.com/raman-cmyk/grey-retention/issues/9)–[#34](https://github.com/raman-cmyk/grey-retention/issues/34)), one per register category, list the 441 P1/P2 items as checklists and hold the P0 issues as sub-issues. A P1/P2 item gets its own issue when work on it starts.

Generated with `node scripts/github/project-plan.mjs --markdown`:

| Milestone             | P0 issues | Issue IDs                                                                                                                      | Category epics (P1/P2 checklists)                |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| M0 Stabilize          | 7         | STAB-001, STAB-002, STAB-003, STAB-004, STAB-005, UX-024, REL-010                                                              | —                                                |
| M1 Design system      | 16        | DS-001, DS-002, DS-003, DS-004, DS-005, DS-006, DS-007, UX-002, UX-004, UX-005, UX-012, UX-013, UX-017, UX-018, UX-020, UX-021 | UX                                               |
| M2 Onboarding         | 40        | ONB-001 … ONB-035, UX-001, UX-011, UX-015, UX-026, REL-020                                                                     | ONB, ACC                                         |
| M3 Competitor watch   | 25        | UX-003, UX-019, UX-023, WATCH-001 … WATCH-020, WATCH-029, WATCH-030                                                            | REF, INT, WATCH                                  |
| M4 Replication engine | 44        | UX-006, UX-007, UX-008, UX-009, UX-010, UX-014, UX-016, REP-001 … REP-030, REP-032 … REP-035, REL-011, REL-013, REL-014        | BRD, CMP, REP                                    |
| M5 Store + delivery   | 45        | REP-031, CAN-001 … CAN-028, REL-001 … REL-009, REL-012, REL-015, REL-016, REL-017, REL-019, REL-024, REL-025                   | CON, STR, DEF, EXE, ADS, CAN, REL                |
| M6 Intelligence       | 14        | UX-022, UX-025, WATCH-021 … WATCH-028, REL-018, REL-021, REL-022, REL-023                                                      | CAL, DES, GRO, RPT, ADM, OPS, LEG, MCP, LRN, KLA |

Why some items sit outside their category's usual milestone: `UX-024` (no dead menus) and `REL-010` (timezone tests) belong with the M0 clean-up; the UX items about navigation, statuses and shared components belong to M1; the replication-related UX items belong to M4; `REP-031` (Klaviyo editor round trip) needs live Klaviyo, so it is M5; competitor playbook analysis (`WATCH-021`…`WATCH-028`) is M6 intelligence.

## Labels

| Label                                       | Meaning                                                       |
| ------------------------------------------- | ------------------------------------------------------------- |
| `priority:P0` / `P1` / `P2`                 | Order of work inside a milestone (P0 first)                   |
| `type:feature` / `bug` / `chore` / `design` | What kind of change it is                                     |
| `area:<category>`                           | One per register category, for example `area:onboarding`      |
| `epic`                                      | The category tracking issue                                   |
| `wip`                                       | Claimed: someone is working on it now (see the claim comment) |

## How we work (one issue at a time)

1. **Pick** the next open P0 issue in the current milestone (lowest milestone first). Run `/start-task <ID>`; it reads the required docs, claims the ledger row and writes a short plan. The issue ID is the ledger task ID. Two IDs already name earlier ledger rows for the same features — `ONB-001` (simple first-use experience) and `REP-001` (exact replication) — so their issues continue those rows and add new handoff entries instead of creating duplicates.
2. **Branch** from the latest `main`: `claude/<id>-<slug>` — the exact name is at the bottom of each issue. One issue per pull request.
3. **Build** with tests for behaviour, authorization, state changes and failure paths. Keep routes thin; logic in `features/` or `lib/`. External systems only through typed adapters with fakes.
4. **Check**: `/verify` (or `pnpm verify`) must pass; add `pnpm supabase:reset && pnpm test:db` for SQL and `pnpm test:e2e` for UI flows. Run the `code-reviewer` subagent before the PR, and `rls-migration-reviewer` for anything under `supabase/`.
5. **Hand off**: `/handoff <ID>` updates the ledger row and the register status (`verified_fixture` only with passing evidence).
6. **Merge** to `main` when green. **Merging deploys the live app** (Vercel), so only merge finished, verified work.
7. **Close** the issue with one plain-English line about what the owner will now see, for example: "The owner now picks the send time from a calendar instead of typing 2026-11-01T10:00:00Z."

Rules that never change:

- New migrations take the next number in their domain range. Applying a migration to the **live Supabase project needs Raman's OK first**.
- Live Klaviyo, Shopify, OpenAI or email, paid AI and sending stay off until Raman says yes in the conversation.
- If something blocks progress, say exactly what is needed from Raman (a key, an OK, a setting).

## Keeping GitHub in sync

`.github/project/roadmap.json` is the single source for labels, milestones and which milestone each issue belongs to. The [Project sync workflow](../.github/workflows/project-sync.yml) applies it: it creates or updates labels (colour and description) and milestones (goal and "done when"), then moves each roadmap issue into its milestone. It never creates, closes or rewrites issues. It runs on every push to `main` that changes the roadmap, the register or `scripts/github/`, or by hand from the Actions tab.

GitHub Actions must be turned on for the repository (Settings → Actions → General). Until then labels stay grey and issues have no milestone; the issue map above is still correct. Check locally with `node scripts/github/project-plan.mjs` (summary) or `--json` (every issue), and `pnpm test scripts/github`.

To change the plan: edit `roadmap.json` (for example move `UX-019` to another milestone in `milestoneOverrides`), run the tests, open a pull request, merge. The sync moves the issue.
