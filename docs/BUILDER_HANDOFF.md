# Builder handoff: build the whole backend, do not stop

Written 15 November 2026 by the supervisor session for the builder sessions (Opus). The owner is Raman. He is not a developer. He wants the product built without being asked for approval at every step.

Read this file fully. Then read `AGENTS.md`, `CLAUDE.md`, `docs/BUILD_BRIEF.md`, `docs/VISION.md`, `docs/AGENT_MAP.md` and `docs/BUILD_LEDGER.md`. Then start with section 4.

## 1. Who does what

| Who                         | Job                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Builder sessions (you)      | All code: database, agents, jobs, Klaviyo, tests, and wiring approved designs into screens  |
| Design session (Fable 5)    | All UI and UX: brand guidelines, then one page at a time in Claude Design                   |
| Raman                       | Approves designs. Gives the OK for live providers. Nothing else should need him             |
| Supervisor (design session) | Reviews pull requests, answers scope questions, keeps this file and the ledger queue honest |

**You never design.** No new layouts, colors, copy or components from you. A screen is built only from a spec in `docs/design/<page>.md` marked `Approved`. Until a page has that file, give it a working data layer and tests, and leave the existing screen alone.

## 2. The loop: how you keep going

Repeat this until the queue in section 4 is empty:

1. Take the first task in section 4 that is not done and not blocked. Claim it in `docs/BUILD_LEDGER.md`.
2. Branch `claude/<task-id>-<slug>` from the latest `main`. One task per pull request.
3. Build it with tests. Run `pnpm verify`. If you touched SQL, CI runs the database tests; read the result.
4. Run the `code-reviewer` subagent. For anything under `supabase/`, also `rls-migration-reviewer`. For providers, `klaviyo-integration`. Fix what they find.
5. Open the pull request. When every check is green, pick the migration number (D24: next after the newest on `main`), merge, confirm `main` is green.
6. Run `/handoff <task-id>`. Go back to step 1 in the same turn.

Rules that keep the loop alive:

- **Do not end your turn to report progress.** The ledger is the report. End a turn only when the queue is empty or every remaining task is blocked.
- **A blocked task is skipped, not waited on.** Write the blocker in one line under "Blocked, needs Raman" in the ledger, then take the next task.
- **Decide small things yourself.** Names, file layout, test shape, error text for logs: choose, note it in the handoff, move on. Follow the conventions already in the code.
- **A failing check is your job.** Fix the cause. Do not skip, mute or delete a test to get green. If a failure is an outside outage (for example the package mirror), re-run once, then note it and continue with another task.
- **Keep pull requests small.** If a task grows past about 600 changed lines, split it into parts (`-part-1`, `-part-2`) and merge each.
- **When context gets long**, finish the current pull request, run `/handoff`, and continue. The ledger and this file carry the state, not your memory.

## 3. The only reasons to stop and ask Raman

Ask in plain words, one question, and keep working on other tasks while you wait.

1. Turning on anything live: `AI_DEFAULT_PROVIDER`, `KLAVIYO_MODE=live`, `KLAVIYO_DRAFT_PUSH=live`, `SITE_READER_MODE=live`, `ADS_READER_MODE=live`, `SCHEDULED_JOBS_ENABLED`, sending email, or spending paid AI beyond the $0.50 a day Gemini cap he already approved.
2. The first real Klaviyo draft, and any call to a real Klaviyo account, even read-only.
3. Deleting or rewriting data in production, or a migration that drops a column or table that holds data.
4. A change to a product rule in `docs/VISION.md` or a decision D1 to D27.
5. A new paid service or account.

Everything else you decide. Never read, print or commit `.env`, `.env.local` or `.audit/`. The repository is public: no secrets, client names or customer data.

Remember: merging to `main` deploys the live app and applies migrations to production. Fake providers stay the default. A merge must be safe with every switch off.

## 4. The queue, in order

Task IDs are suggestions. Reuse the ledger's ID where one exists. The detail for each row is in `docs/AGENT_MAP.md` under the heading named in the row.

### Phase 0: land what is open

| ID        | Task                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------ |
| LAND-DOCS | Open and merge a pull request for `claude/docs-design-studio` (agent map D25 to D27, this file)  |
| LAND-382  | Merge #382 (CI-004, browser install is best-effort). Checks were green                           |
| LAND-383  | Merge #383 (ONB-103) as it is. The supervisor approved it. Re-run the failed run first if needed |
| LAND-OPEN | Rebase, re-run and merge #380, #381, #384 (PSH-001), #385 (ONB-104), #386 (ONB-105), LRN-001     |

Migration numbers are chosen at merge, in merge order, after `20260914090058`.

Answers the supervisor already gave, apply them:

- PSH-001: lane A renders the Klaviyo-mode HTML; QA is split; a sample audience is rejected when the mode is live.
- The pusher must detect owner edits in Klaviyo (keep a hash of the last push) and never overwrite them silently.
- Force `KLAVIYO_MODE` and `KLAVIYO_DRAFT_PUSH` off in the session environment settings, the same way `ADAPTER_MODE` is forced to fake.

### Phase 1: make every run reliable (do this before any new feature)

A test run on 15 November found these. Each is a task.

| ID      | Task                                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-081 | Resumable build job: "Create email" runs as steps in the job queue, each step saved, each under the 60 second limit, safe to retry. The design studio cannot fit in one request (pick 81) |
| REL-084 | Never fail silently: every fallback, dropped offer and skipped step writes a reason the owner screen can show (pick 84)                                                                   |
| REL-AI  | "Create email" must use the agent path. Today it uses the no-AI path and 12 emails got the same subject. Add a test that two slots never share a subject                                  |
| REL-OFF | An offer above the max discount or with an unknown code is replaced by a safe fallback and logged, not dropped without a trace                                                            |
| REL-DAT | Reject past dates and dates outside the plan window on plan and create commands                                                                                                           |
| REL-ONB | The plan and the email build must read the onboarding findings (brand facts, voice, products). Today they are not used                                                                    |
| REL-PRV | Add a second AI provider behind the same adapter, off by default, so one outage does not stop every run                                                                                   |

### Phase 2: the design studio (D25). This is the product's edge

Heading: "How an email gets drawn" and "Design studio (§4 layer 3)".

| ID      | Task                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DST-001 | Real renderer port: sections written in HTML and CSS with the brand's fonts and product cut-outs, rendered by a headless browser to 1,200 px wide images |
| DST-002 | Art director agent: picks the reference email and writes the section plan                                                                                |
| DST-003 | Section designer agent: draws each section; buttons, product grid, key text and footer stay live HTML                                                    |
| DST-004 | Match score against the reference, and the design critic (checklist, 8 out of 10 to pass, 3 rounds at most)                                              |
| DST-005 | Hard checks (width, weight, alt text, contrast, links, offer within limit) and the inbox preview (desktop, phone, dark)                                  |
| DST-006 | Fallback: if the studio fails or scores low, build from coded blocks and say so in the run log                                                           |
| DST-007 | Email length: a designed email should run about 2,000 px tall at 600 wide. Today emails come out near 850 px                                             |
| EML-AB  | A versus B: one Klaviyo draft with two variations (A coded blocks, B designed), 50/50, no automatic winner. Build on #381                                |
| DST-PIC | Every remaining owner pick under "Design studio", one pull request each, in table order                                                                  |

### Phase 3: text emails (D26)

Heading: "Copy and text emails". A text email is its own format, not a designed email without pictures. Build the format, its checks, and every pick in that table.

### Phase 4 to 9: the rest of the owner's picks (D27)

One pull request per pick, in the table order under each heading. Finish a heading before the next.

| Phase | Heading in `docs/AGENT_MAP.md`     | Also covers                                          |
| ----- | ---------------------------------- | ---------------------------------------------------- |
| 4     | Strategy and planning (§3)         | PLAN-SEG-001, SEG-STRATEGY-001                       |
| 5     | Competitor intelligence and blocks | BLK-SCALE-001, the path to 2,000+ blocks             |
| 6     | Onboarding and brand understanding | Remaining ONB tasks                                  |
| 7     | Learning from results (§5)         | MEM-DONT-001, do's and don'ts from results and edits |
| 8     | Deliverability and Klaviyo         | The pusher, drafts only, owner-edit detection        |
| 9     | Agent reliability, Agency business | Anything left in those two tables                    |

"Owner experience" picks need a design. Build only their data layer (section 5) until the page spec is approved.

### Phase 10: build approved screens

When `docs/design/<page>.md` says `Approved`, a `UI-<page>` task joins the front of the queue. Build it exactly: tokens from `docs/design/BRAND.md`, the layout and copy in the spec, nothing added. Add a Playwright journey for it.

## 5. Data each page needs (build this ahead of the designs)

The design session is drawing these pages. Give each one a typed, server-side read model in `features/<domain>/` with tests, so wiring a screen later is small work. No new screens yet.

| Page               | Read model must return                                                                                                 | Commands it needs                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Onboarding (5)     | Step state and resume point; brand found (name, logo, colors, fonts, products); Klaviyo status; offers                 | Save each step; connect Klaviyo; finish      |
| Home               | Current plan window and slot states; email revenue, opens, clicks for 30 days; next 3 slots; offers; top learned items | Plan next 15 days; create email              |
| Plan               | 15 slots: date, subject, audience, offer, format (designed or text), status                                            | Plan next 15 days; create email; move a slot |
| Email              | Subject, preview text, audience, send time, offer, rendered HTML for desktop, phone and dark, run log, Klaviyo link    | Create; make another; open in Klaviyo        |
| Inspiration        | Reference emails (own and competitors) with tags, thumbnail, source                                                    | Add an email; remove                         |
| Audiences          | Segments with size and last refresh; exposure per customer                                                             | Build a segment from chat text; save         |
| Ask GROS           | Chat threads, messages, the evidence behind an answer                                                                  | Send a message; start a thread               |
| Results            | Per email: sent, opens, clicks, revenue; A versus B result                                                             | None                                         |
| Learned            | Do and avoid items with the source (result, inspector, owner edit) and date                                            | Remove an item; pin an item                  |
| Settings           | Max discount, codes, Klaviyo connection, brand kit, team                                                               | Existing offer commands; disconnect; invite  |
| States (all pages) | Job progress by step with plain-language labels; empty and error reasons from REL-084                                  | Retry a failed step                          |

Every read model: tenant from the session, RLS on, no service role in the browser, a fake-provider test and a denial test for another tenant.

## 6. Conventions that have bitten before

- Business conflicts raise `PT409`, never `40001`.
- Lock the tenant first, then campaign, job or usage rows.
- Commands are `SECURITY DEFINER` with `search_path=''`; revoke direct writes from `service_role`; revoke `MAINTAIN` on Postgres 17.
- Every AI call goes through `runAi` (budget reserve, then settle) and agents through `runAgent`. `maxOutputTokens` is room for the answer; the provider adds the thinking budget.
- Generated types only from `pnpm supabase:types`. Never edit a merged migration.
- `pnpm build` and `pnpm test:e2e` share `.next/`. Never run them together.
- Long work goes through the job queue and must be idempotent.

## 7. Two builders at once

If two builder sessions run, keep the lanes you already hold. If unsure: lane A takes phases 1, 2 and 3 (email build, design studio, text emails). Lane B takes phase 0, then 4 to 9 (onboarding, competitors, strategy, Klaviyo, learning). Section 5 belongs to whoever owns the domain. Claim before you start, and rebase on `main` before every merge so migration numbers never collide.

## 8. What "done" means for the whole job

Raman connects a real store, clicks "Plan next 15 days", clicks "Create email" on a slot, and gets a polished designed email about 600 by 2,000 px as a draft in Klaviyo, with a run log that explains every choice, and the system learns from the result. Until that works end to end with fake providers and passes with live ones after his OK, the queue is not empty.
