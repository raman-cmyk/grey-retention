# V2 build progress

Checkpoint: October 4, 2026. Branch `codex/grey-retention-v2`; base `b6f92a7`.

## Active task

V2-001: root integration owner. Owns workflow contracts/policies/ports, shared integration, allocated migrations, tests and checkpoint documentation. Required project/build/use-case/UML/design documents read; existing foundation and identity inspected. Planning changes were present before this run and preserved on the feature branch. Sequential execution; no agents.

V2-000 passed `pnpm verify` (15 tests, format/lint/types/build). Planning preserved in `bf6f968`; contracts committed next.

Next action: implement V2-001 brand/catalog/calendar schema, transactional revision actions, shared forms and calendar/editor UI; generate database types through local tooling; authenticated persistence/RLS/browser checks.

## Verification and limits

- Existing migrations: `20260914000000_foundation.sql`, `20260914010000_identity_tenancy.sql`.
- Docker was stopped initially; Docker application started for local verification. No Grey Retention Supabase containers existed. The CLI is creating a new disposable local project; remote linked project is never accessed/reset.
- Contract policy gate verified; persisted domain gates pending. Existing demo auth remains baseline only; persisted acceptance must use real local Supabase sessions.
- External providers remain fake; production sending, SMS, paid AI, L2 delegation, real classification evaluation and cross-client publication remain disabled.

## Tracked processes

- Docker application started by this run (local infrastructure).
- Supabase start: tool session `83787`; local ports configured 54321–54324, 54327, 8083. Stop project services at finish and verify listening ports.
- No app server or worker started yet.
