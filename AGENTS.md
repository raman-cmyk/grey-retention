# Grey Retention repository instructions

This repository is a clean-room implementation derived from observed product behavior. Do not copy proprietary source, private prompt text, credentials, customer content, or secrets into code, fixtures, documentation, commits, or tool output.

Before changing code, read completely:

1. `docs/BUILD_BRIEF.md` (start here: what we build now, which document wins, owner decisions, lanes)
2. `docs/VISION.md` (the owner's v2 product brief: the source of truth for product rules, steps and gates)
3. `docs/ARCHITECTURE_BLUEPRINT.md` and `docs/SYSTEM_ARCHITECTURE.md` (code structure)
4. `docs/BUILD_LEDGER.md`

For screens, read `docs/DESIGN_RULES.md` and `docs/DESIGN_RESET.md` first. The hard anti-decoration and minimal-motion rules apply to every design/prototype/UI change; current design scope is desktop/laptop first. The old-app 1:1 rebuild and current visual direction are superseded. Use `docs/UI_REBUILD_SPEC.md`, `docs/DESIGN.md` and `docs/OWNER_JOURNEYS.md` only as historical/functional references, never replacement layout requirements. Capture explicit owner to-dos in `docs/PROJECT_TODOS.md` after each discussion; distinguish proposals, approved decisions and verified implementation. Use `GREY_RETENTION_DISCOVERY.md` for behavioral reference only. Old plans live in `docs/archive/`; don't follow them. The architecture blueprint wins when the original product exhibits a defect or contradiction.

## Working rules

- Work only on the assigned task ID and owned paths unless integration requires a narrowly justified change.
- Inspect the current worktree and ledger before starting; preserve unrelated work.
- Claim the task in `docs/BUILD_LEDGER.md` by setting its status and task name.
- Do not silently change shared contracts. Record any necessary change under Global decisions and in the handoff log.
- Respect the migration-number allocation in the ledger. Never renumber a shared migration.
- Keep route components thin; business logic belongs in `features/` or `lib/`.
- Validate all server inputs, authorize on the server, and keep RLS enabled.
- Never expose Supabase service role, provider keys, integration credentials, encryption keys, or cron secrets to the browser.
- External systems must be accessed through typed adapters with fake/fixture implementations.
- Long-running or retryable work must use the job/queue abstraction and be idempotent.
- Do not add a dependency or rewrite shared configuration merely for convenience. If required, explain it in the ledger handoff.
- Do not use hardcoded tenant/user IDs outside deterministic seed fixtures.
- Add tests for behavior, authorization boundaries, state transitions, and failure paths introduced by the task.
- Run the relevant checks plus typecheck before handoff. Run the full suite when touching shared contracts.
- Update the task row and append the prescribed handoff entry before declaring completion.
- Do not deploy, connect live providers, send email, consume paid AI, or mutate external accounts unless the user explicitly authorizes that step.

## Shared code ownership

- Foundation/integration owner: root configs, lockfile, dependency changes, shared result/error/env/logging contracts, generated database types, CI.
- IAM: auth, tenancy, request context, membership/invite policies, `2026091401xxxx` migrations.
- UI: project-owned UI primitives, role shells, navigation, shared loading/empty/error states.
- AI/Brand: brand context, prompts, knowledge injection, provider-neutral AI execution, `2026091402xxxx` migrations.
- Integrations: jobs/queues, provider adapters, Klaviyo/Shopify, dashboard sync, `2026091403xxxx` migrations.
- Campaigns: campaign/calendar/audience/content state, `2026091404xxxx` migrations.
- References: template/reference/competitor domains, `2026091405xxxx` migrations.
- Designers: assignment/submission/review workflow, `2026091406xxxx` migrations.
- Support: team/settings/holidays/support/feedback/notifications, `2026091407xxxx` migrations.
- Operations: packages, reports, admin operations and provider status, `2026091408xxxx` migrations.
- Final integration: cross-domain fixes and `2026091409xxxx` migrations.

When path ownership overlaps, coordinate through a typed interface or leave an integration note instead of editing another workstream's implementation blindly.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
