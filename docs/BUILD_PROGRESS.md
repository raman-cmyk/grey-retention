# V2 build progress

Checkpoint: October 4, 2026. Branch `codex/grey-retention-v2`; base `b6f92a7`.

## Active task

V2-002: root integration owner, sequential execution. No agents. Owns designer workflow, minimal jobs/delivery/provider fixtures, notifications, campaign copy/approval wiring, shared dialogs/tables, allocated migrations and tests.

Next action: implement version-bound copy generation/approval; admin assignment; private Storage submissions; owner section feedback/resubmission approval; immutable final package and durable fake schedule/cancel with leases/idempotency. Then run DB/type/unit/browser gates and continue V2-003 onward.

## Checkpoints

- Planning preserved: `bf6f968`.
- V2-000 complete: `b5dd47f`, `pnpm verify` — 15 tests, lint/format/types/build.
- V2-001 core gate passed (review; shared dialog/table remainder carried into V2-002): clean reset and reproducible synthetic seed; generated types; `pnpm test:db` 33 assertions; `pnpm verify` 16 tests and production build; `pnpm test:e2e` 8 authenticated journeys across desktop/mobile. Screenshots inspected; no overflow; cross-tenant read and unauthorized approval denied. Commit recorded next.

Migrations: foundation `20260914000000`; identity `20260914010000`; brand/catalog `20260914020000`; campaigns `20260914040000`; transactional commands `20260914090000`. Generated types come only from `supabase gen types typescript --local`.

## Decisions and limits

Required project/build/use-case/UML/design documents read completely; relevant discovery and installed Next.js guides read. Original planning changes preserved. No live provider, old source/database/customer imports, paid AI, pushes, merges or deployment.

Local fixtures have no committed passwords. `scripts/local-runtime.mjs` refuses non-loopback URLs, prepares synthetic accounts using local Auth Admin API, and keeps random credentials in ignored `.audit/local-accounts.json`. `pnpm test:e2e` supplies only local env without modifying the existing `.env.local`.

Brand facts/offers require owner; staff can edit unapproved drafts; platform admin cannot creatively approve. Material changes invalidate affected revisions. Approvals/audit history persist. External provider mode is fake; real classification/vision/design quality, live sending/SMS, production L2 delegation, real suppression and cross-client publication remain disabled/unverified.

## Tracked processes

- Docker application started by this run for local infrastructure; it was initially stopped. No Grey Retention containers existed before the run. Other stopped project containers untouched.
- Supabase project `grey-retention`: task-created disposable local containers; configuration ports 54321–54324, 54327, 8083 (inspect actual listeners at cleanup). `pnpm supabase:stop` at finish; no remote linked project is accessed/reset.
- App/test server port 3100: tracked Playwright sessions ended and port verified closed.
- Current verify session: tracked by tool; no persistent worker/server.
