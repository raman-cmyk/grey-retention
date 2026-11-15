# Master handoff: the one document to build GROS from

Written 15 November 2026 by the supervisor session for every Claude Code builder session. The owner is Raman. He is not a developer. He wants the product built without approving every step, and he wants nothing basic forgotten.

**Read this whole file first.** Then `AGENTS.md`, `CLAUDE.md`, `docs/BUILD_BRIEF.md`, `docs/VISION.md`, `docs/AGENT_MAP.md`, `docs/BUILD_LEDGER.md`. If this file and an older document disagree, this file wins, except for product rules in `docs/VISION.md` and decisions D1 to D27.

Contents: 1 the product · 2 what went wrong before · 3 where we are · 4 who does what · 5 the loop · 6 when to ask Raman · 7 the queue · 8 basics that must exist · 9 the checklist for every feature · 10 screens to keep and retire · 11 data each page needs · 12 conventions · 13 what done means.

## 1. The product, in plain words

A small store owner who uses Klaviyo connects his store. He sets his biggest discount and his real discount codes. He clicks **Plan next 15 days** and gets a 15-day email plan. He clicks **Create email** on a day and a team of AI agents writes, designs and checks the email, then puts it in Klaviyo as a draft. Nothing sends without him. The system learns do's and don'ts from results and from competitors' emails.

The edge is **design quality**: a polished email, 600 px wide and about 2,000 px tall, that looks made by a good agency designer. Text emails are a second format of their own.

Hard rules: no human in the loop inside a run (D16). No weekly approval (D17). Drafts only until the owner schedules. The AI never invents a discount or a code. Klaviyo only. No Shopify. No human designer.

## 2. What went wrong before, and what changes

- **We copied the old product screen by screen.** The app has about 55 screens, many for jobs this product does not have (designer workspace, flows, lists, metrics, optimizer, copy review). Stop. Build only what section 1 needs.
- **We built without a design.** From now on a screen is built only from an approved design spec (section 4).
- **Basics were skipped.** Features shipped with only the happy path. Section 8 lists the basics that must exist. Section 9 is a checklist every feature must pass before it merges.

## 3. Where we are (checked in the repository on 15 November 2026)

Checked from git. Pull request pages on GitHub were not opened, so review comments are not included here.

**`main`** is at `6630090` (pull request #377, 12 November). It has 82 migrations, 45 database test files, 38 browser test files and about 45 feature folders.

**Already in the code on `main`** (exists and tested with fake providers; not proven with live providers):

- Sign up, log in, forgot password, reset password, auth callback, team invites, roles, tenant isolation with RLS.
- Job queue with leases, AI gate with budget (`runAi`), agent runtime and shared memory (`runAgent`), Gemini adapter, usage metering.
- Inbox reader for competitor emails, screenshots, email classifier and section tagger, variant maker, block library and gallery.
- Onboarding readers (some), strategy agents (plan), email build layers (section planner, content locker, inspectors, designers A and B), "Create email" from a plan slot, offers (max discount and codes).
- Klaviyo adapter with a fake, webhook that fails closed.

**Open and not merged** (10 pull request heads):

| PR   | What                                         | Do                                             |
| ---- | -------------------------------------------- | ---------------------------------------------- |
| #382 | CI-004 browser install is best-effort        | Merge. Checks were green                       |
| #383 | ONB-103                                      | Merge as is. Supervisor approved               |
| #380 | STR-003: plan with no offers on the last try | Rebase, re-run, merge                          |
| #381 | EML-005 part 1: A versus B                   | Rebase, re-run, merge                          |
| #384 | PSH-001: push drafts to Klaviyo              | Apply the answers in section 7, merge          |
| #385 | ONB-104                                      | Rebase, re-run, merge                          |
| #386 | ONB-105                                      | Rebase, re-run, merge                          |
| #337 | APR-002 weekly approval email                | **Close.** Weekly approval is cancelled (D17)  |
| #338 | Docs: calm minimal light design              | **Close.** Replaced by the new brand direction |
| #339 | Docs: start the prototype with onboarding    | **Close.** Replaced by this file               |

Also unmerged: branch `claude/docs-design-studio` (agent map D25 to D27, the owner's 61 picks, this file) and the LRN-001 branch. About 40 old remote branches are already merged or dead; delete a branch after its pull request merges, and leave the rest alone.

**Known broken or missing, from a test run on 15 November:**

- "Create email" used the no-AI path: 12 emails got the same subject.
- An offer above the limit or with an unknown code was dropped with no trace.
- Past dates were accepted.
- The screenshot and hero image ports are fakes only. The design studio does not exist yet.
- Emails come out about 850 px tall, not 2,000.
- The plan and the email build do not read what onboarding learned about the brand.
- One AI provider only. A build must fit in 60 seconds, and the design studio will not.
- No golden test set to tell whether email quality got better or worse.

**Owner setup still open** (only Raman can do these; never put secrets in chat or the repo): Gmail app password in Vercel, Gemini key in Vercel, a Klaviyo private key for the test brand.

## 4. Who does what

| Who                      | Job                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Builder sessions (Opus)  | All code: database, agents, jobs, Klaviyo, tests, and wiring approved designs into screens |
| Design session (Fable 5) | All UI and UX: brand guidelines first, then one page at a time in Claude Design            |
| Raman                    | Approves designs. Gives the OK for live providers                                          |
| Supervisor               | Reviews pull requests, answers scope questions, keeps this file and the queue honest       |

**Design direction** (draft, waiting for Raman's yes): soft white rounded cards on a light grey page, lime green `#B9F26C` with deep green `#14401F`, big numbers, pill navigation, very few words. `docs/DESIGN_RULES.md` still describes the old direction and will be rewritten when the brand is approved.

**How a screen gets built:**

1. The design session writes what the page needs and designs it.
2. Raman approves it.
3. The design session adds `docs/design/<page>.md` marked `Approved`, with layout, copy, states and tokens. Brand tokens live in `docs/design/BRAND.md`.
4. A `UI-<page>` task goes to the front of the builder queue.
5. The builder builds it exactly. No added text, no extra buttons, no new colors.

**Builders never design.** Until a page has an approved spec, build its data layer and tests (section 11) and leave the old screen as it is.

## 5. The loop: how you keep going

Repeat until the queue in section 7 is empty:

1. Take the first task that is not done and not blocked. Claim it in `docs/BUILD_LEDGER.md`.
2. Branch `claude/<task-id>-<slug>` from the latest `main`. One task per pull request.
3. Build it with tests. Go through the checklist in section 9. Run `pnpm verify`. For SQL, read the database test result in CI.
4. Run the `code-reviewer` subagent. Under `supabase/`, also `rls-migration-reviewer`. For providers, `klaviyo-integration`. Fix what they find.
5. Open the pull request with the section 9 checklist filled in. When every check is green, pick the migration number (D24: next after the newest on `main`), merge, confirm `main` is green.
6. Run `/handoff <task-id>`. Go back to step 1 in the same turn.

Rules that keep the loop alive:

- **Do not end your turn to report progress.** The ledger is the report. End a turn only when the queue is empty or every task left is blocked.
- **A blocked task is skipped, not waited on.** Write one line under "Blocked, needs Raman" in the ledger and take the next task.
- **Decide small things yourself**: names, file layout, test shape. Note the choice in the handoff.
- **A failing check is your job.** Fix the cause. Never skip, mute or delete a test to get green. For an outside outage, re-run once, note it, and work on another task.
- **Keep pull requests small.** Past about 600 changed lines, split into parts and merge each.
- **When context gets long**, finish the current pull request, run `/handoff`, continue. The ledger carries the state.

## 6. The only reasons to stop and ask Raman

Ask one question in plain words, and keep working on other tasks while you wait.

1. Turning on anything live: `AI_DEFAULT_PROVIDER`, `AI_V2_PROVIDER=openai` (the second AI provider, REL-PRV), `EMAIL_BUILD_AGENTS=on` (the AI team in "Create email", REL-AI), `KLAVIYO_MODE=live`, `KLAVIYO_DRAFT_PUSH=live`, `SITE_READER_MODE=live`, `ADS_READER_MODE=live`, `SCHEDULED_JOBS_ENABLED`, sending email, or paid AI beyond the $0.50 a day Gemini cap he approved.
2. The first real Klaviyo draft, and any call to a real Klaviyo account, even read-only.
3. Deleting or rewriting production data, or a migration that drops a table or column that holds data.
4. Changing a product rule in `docs/VISION.md` or a decision D1 to D27.
5. A new paid service or account.

Never read, print or commit `.env`, `.env.local` or `.audit/`. The repository is public: no secrets, client names or customer data. Merging to `main` deploys the live app and applies migrations to production, so every merge must be safe with all switches off.

## 7. The queue, in order

Reuse the ledger's task ID where one exists. Details for agent work are in `docs/AGENT_MAP.md` under the heading named in the row.

### Phase 0: land or close what is open

Do the "Do" column of the table in section 3. Then open and merge a pull request for `claude/docs-design-studio`. Migration numbers are chosen at merge, in merge order, after `20260914090058`.

Answers already given by the supervisor, apply them:

- PSH-001: lane A renders the Klaviyo-mode HTML; QA is split; a sample audience is rejected when the mode is live.
- The pusher keeps a hash of its last push and never overwrites an email the owner edited in Klaviyo.
- Force `KLAVIYO_MODE` and `KLAVIYO_DRAFT_PUSH` off in the session environment settings, like `ADAPTER_MODE`.

### Phase 1: reliability, before any new feature

| ID      | Task                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-081 | Resumable build job: "Create email" runs as saved steps in the job queue, each under 60 seconds, safe to retry (owner pick 81)                     |
| REL-084 | Never fail silently: every fallback, dropped offer and skipped step stores a plain-language reason the owner can see (owner pick 84)               |
| REL-AI  | "Create email" uses the agent path. Add a test that two slots in one plan never share a subject                                                    |
| REL-OFF | An offer above the max or with an unknown code is replaced by a safe fallback and logged                                                           |
| REL-DAT | Reject past dates and dates outside the plan window                                                                                                |
| REL-ONB | The plan and the email build read the brand facts, voice and products from onboarding                                                              |
| REL-PRV | A second AI provider behind the same adapter, off by default                                                                                       |
| REL-EVL | Golden test set: 10 fixed briefs with expected properties, run on the fake AI in CI, so quality regressions show (supervisor addition, not a pick) |

### Phase 2: basics that must exist

Every row in section 8 marked Missing or Partly. One pull request per row. Rows that need a screen build the server side and tests now, and the screen when its design is approved.

### Phase 3: the design studio (D25)

Heading: "How an email gets drawn" and "Design studio (§4 layer 3)".

| ID      | Task                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| DST-001 | Real renderer: sections in HTML and CSS with brand fonts and product cut-outs, rendered by a headless browser to 1,200 px wide images |
| DST-002 | Art director agent: picks the reference and writes the section plan                                                                   |
| DST-003 | Section designer agent: draws each section; buttons, product grid, key text and footer stay live HTML                                 |
| DST-004 | Match score against the reference, and the design critic (checklist, 8 of 10 to pass, 3 rounds at most)                               |
| DST-005 | Hard checks (width, weight, alt text, contrast, links, offer within limit) and inbox preview (desktop, phone, dark)                   |
| DST-006 | Fallback to coded blocks when the studio fails or scores low, with the reason in the run log                                          |
| DST-007 | Email length: about 2,000 px tall at 600 wide                                                                                         |
| EML-AB  | A versus B: one Klaviyo draft, two variations, 50/50, no automatic winner. Builds on #381                                             |
| DST-PIC | Every remaining owner pick under "Design studio", one pull request each, in table order                                               |

### Phase 4: text emails (D26)

Heading: "Copy and text emails". Its own format with its own checks. Then every pick in that table.

### Phase 5 to 10: the rest of the owner's 61 picks (D27)

One pull request per pick, in table order. Finish a heading before the next.

| Phase | Heading in `docs/AGENT_MAP.md`     | Also covers                                      |
| ----- | ---------------------------------- | ------------------------------------------------ |
| 5     | Strategy and planning (§3)         | PLAN-SEG-001, SEG-STRATEGY-001, SEG-EXPOSURE-001 |
| 6     | Competitor intelligence and blocks | BLK-SCALE-001, the path to 2,000+ blocks         |
| 7     | Onboarding and brand understanding | Remaining ONB tasks, ONB-106 Brand book          |
| 8     | Learning from results (§5)         | LRN-001, LRN-002, MEM-DONT-001                   |
| 9     | Deliverability and Klaviyo         | The pusher, drafts only, owner-edit detection    |
| 10    | Agent reliability, Agency business | Anything left in those two tables                |

"Owner experience" picks need a design. Build their data layer only, until the page spec is approved.

### Phase 11: approved screens and retiring old ones

`UI-<page>` tasks as designs are approved (they jump the queue). When a new page replaces old screens, remove the old routes in the same pull request (section 10).

### Two builders at once

Keep the lanes in `docs/BUILD_BRIEF.md` section 5. Lane A (agents and email): phases 1, 3, 4. Lane B (data and integrations): phases 0, 2, then 5 to 10. Claim before you start. Rebase on `main` before every merge so migration numbers never collide.

## 8. Basics that must exist

Status is from a search of the code on 15 November. "Exists" means the code is there, not that it was proven live. Re-check each row before you build it.

### Account and access

| Basic                                                        | Status                                        |
| ------------------------------------------------------------ | --------------------------------------------- |
| Sign up, log in, log out                                     | Exists                                        |
| Forgot password and reset password                           | Exists, but no browser test. Add one          |
| Confirm email after sign up, and "send the email again"      | Partly. Resend is missing                     |
| Change password while logged in                              | Missing                                       |
| Change email, with confirmation to the new address           | Missing                                       |
| Session ran out: return to login, then back to the same page | Partly. Check every area                      |
| Limit on login, sign up and reset attempts                   | Check. Rate limits exist; confirm these three |
| Invite a teammate, accept, change role, remove               | Exists. Add: expired and reused invite links  |
| Delete my account, and delete the whole workspace            | Missing. Ask Raman before any real deletion   |
| Record of who changed what (discount, codes, Klaviyo, team)  | Missing                                       |

### Klaviyo connection

| Basic                                                                  | Status                    |
| ---------------------------------------------------------------------- | ------------------------- |
| Connect, see status, disconnect, reconnect                             | Exists. Verify each state |
| Key stopped working: clear message, one button to fix                  | Check                     |
| Klaviyo slow or down: retry with backoff, then a reason the owner sees | Check                     |
| Draft deleted or edited in Klaviyo: app notices, does not overwrite    | Missing (part of PSH-001) |

### Every email the product makes

| Basic                                                               | Status                       |
| ------------------------------------------------------------------- | ---------------------------- |
| Unsubscribe link in every email                                     | Exists. Make it a hard check |
| Sender's postal address in the footer                               | Partly. Make it a hard check |
| Discount never above the max, code is a real active code            | Exists in parts. See REL-OFF |
| Alt text, working links, readable in dark mode, sensible on a phone | Planned in DST-005           |
| Subject and preview text present, not repeated across the plan      | Missing. See REL-AI          |

### The app itself

| Basic                                                                    | Status                                      |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| Loading, empty and error state on every screen                           | Partly. Group files exist; check each       |
| Page not found, and a last-resort error page (`global-error.tsx`)        | Not found page exists. The other is missing |
| Long jobs show progress by step, can be left and come back to, can retry | Missing. See REL-081                        |
| Times shown in the store's time zone, send dates in the store's zone     | Check                                       |
| Privacy policy and terms pages, linked from sign up                      | Missing. Raman supplies the text            |
| Page titles, favicon, share image                                        | Check                                       |
| Help or contact route that reaches a person                              | Exists (`support`). Verify it delivers      |
| Works with keyboard only; labels on inputs; readable contrast            | Check on each new screen                    |
| Nothing in the app sends an email or spends money by accident            | Exists. Keep every switch off by default    |

Not in scope unless Raman asks: sign in with Google, two-step login, billing, a phone app.

## 9. The checklist for every feature

Paste this into every pull request and answer each line. "Not needed" must say why. A pull request with an unanswered line is not done. This is what stops "we forgot the forgot-password".

**The whole journey**

- [ ] How does the user get here, and how do they leave or go back?
- [ ] First time, with no data: what do they see?
- [ ] Can they change it later? Remove it? Undo it?
- [ ] What happens if they do it twice, or in two tabs at once?
- [ ] What happens if they close the tab half way and return?

**When things go wrong**

- [ ] Wrong or empty input: a clear message next to the field.
- [ ] The outside service fails (AI, Klaviyo, site reader): retry, then a safe fallback, then a reason the owner can read.
- [ ] The session ran out in the middle.
- [ ] The user has no right to do this: the server refuses, not just the screen.
- [ ] A user from another store tries: sees nothing, changes nothing.

**Every role**: owner, admin, staff, platform operator, not logged in. Each has a test.

**Money and sending**: can this send an email, spend paid AI, or change something in Klaviyo? If yes, it is behind a switch that is off by default.

**Proof**

- [ ] Unit tests for rules and failure paths.
- [ ] Database tests for every new table, policy and command, with denial tests.
- [ ] A browser test for the journey, if a screen changed.
- [ ] Anything left out is written as a new row in the ledger, with an ID. Nothing is left only in your head.

## 10. Screens to keep, replace and retire

The new app has 16 pages: five onboarding steps, Home, Plan, Email, Text email, Inspiration, Audiences, Ask GROS, Results, Learned, Settings, and shared states. Old routes on `main` map like this. Retire a route only in the pull request that ships its replacement, or when this table says it has none.

| Old routes                                                                                           | Becomes                                            |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `login`, `signup`, `forgot-password`, `reset-password`, `auth/callback`                              | Keep. Restyle when designed                        |
| `get-started`, `onboarding`, `first-draft`, `store`, `brand`, `brand/voice`, `connections`           | Onboarding (5 steps) and Settings                  |
| `dashboard`                                                                                          | Home                                               |
| `plan`, `plan/email/[buildId]`, `campaigns/*`, `emails/[resultId]`, `create-email`, `campaign-agent` | Plan, Email, Text email                            |
| `email-library`, `library/inspirations`, `competitor-agent`, `import-reference`, `assets`            | Inspiration                                        |
| `segments`, `lists`                                                                                  | Audiences                                          |
| `gros`                                                                                               | Ask GROS                                           |
| `reports`, `metrics`, `optimizer`                                                                    | Results and Learned                                |
| `settings`, `profile`, `team`, `support`, `feedback`, `holidays`                                     | Settings                                           |
| `copy-review`, `flows`, `flow-messages`                                                              | Retire. No replacement (no human review, no flows) |
| `(designer)/*`, `designer/login`, `admin/designers`                                                  | Retire. There is no human designer                 |
| `admin/*` (clients, prompts, templates, inbox, operations)                                           | Keep for the platform operator. Not redesigned now |

Retiring a route means removing the page, its navigation link and tests that only cover it. Keep database tables and data. Dropping tables is a separate task that needs Raman (section 6).

## 11. Data each page needs

Build a typed, server-side read model per page in `features/<domain>/`, with tests, before its design arrives. No new screens yet.

| Page               | Read model returns                                                                                             | Commands                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Onboarding (5)     | Step state and resume point; brand found (name, logo, colors, fonts, products); Klaviyo status; offers         | Save each step; connect Klaviyo; finish                        |
| Home               | Plan window and slot states; email revenue, opens, clicks for 30 days; next 3 slots; offers; top learned items | Plan next 15 days; create email                                |
| Plan               | 15 slots: date, subject, audience, offer, format, status                                                       | Plan next 15 days; create email; move a slot                   |
| Email, Text email  | Subject, preview text, audience, send time, offer, HTML for desktop, phone and dark, run log, Klaviyo link     | Create; make another; open in Klaviyo                          |
| Inspiration        | Reference emails (own and competitors) with tags, thumbnail, source                                            | Add; remove                                                    |
| Audiences          | Segments with size and last refresh; exposure per customer                                                     | Build a segment from chat text; save                           |
| Ask GROS           | Threads, messages, the evidence behind an answer                                                               | Send a message; start a thread                                 |
| Results            | Per email: sent, opens, clicks, revenue; A versus B result                                                     | None                                                           |
| Learned            | Do and avoid items with source and date                                                                        | Remove; pin                                                    |
| Settings           | Max discount, codes, Klaviyo connection, brand kit, team, account                                              | Offer commands; disconnect; invite; section 8 account commands |
| States (all pages) | Job progress by step in plain language; empty and error reasons                                                | Retry a failed step                                            |

Every read model: tenant from the session, RLS on, no service role in the browser, a fake-provider test, and a denial test for another tenant.

## 12. Conventions that have bitten before

- Business conflicts raise `PT409`, never `40001`.
- Lock the tenant first, then campaign, job or usage rows.
- Commands are `SECURITY DEFINER` with `search_path=''`. Revoke direct writes from `service_role`. Revoke `MAINTAIN` on Postgres 17.
- Every AI call goes through `runAi` (reserve, then settle). Agents go through `runAgent`. `maxOutputTokens` is room for the answer; the provider adds the thinking budget.
- Generated types only from `pnpm supabase:types`. Never edit a merged migration.
- `pnpm build` and `pnpm test:e2e` share `.next/`. Never run them together.
- Long work goes through the job queue and must be idempotent.
- Next.js here is version 16. Read `node_modules/next/dist/docs/` before touching routing, caching or server actions.

## 13. What done means

Raman signs up, connects a real store, sets his discount, clicks **Plan next 15 days**, clicks **Create email**, and gets a polished designed email of about 600 by 2,000 px as a draft in Klaviyo, with a run log that explains each choice. He can reset his password, change it, invite a teammate, fix a broken Klaviyo key and understand every error without asking anyone. The system learns from the result. Until all of that works on fake providers, and on live ones after his OK, the queue is not empty.
