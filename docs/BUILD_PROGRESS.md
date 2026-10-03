# V2 build progress

Checkpoint: October 4, 2026. Branch `codex/grey-retention-v2`; base `b6f92a7`.

## Active task

V2-005 verified; recording focused checkpoint before claiming V2-006. Sequential root execution; no agents. Next action: fixture design orchestration, real inspectable strip artifacts, owner section review, guarded assembly and private template reuse.

## Checkpoints

- Planning preserved: `bf6f968`.
- V2-000 complete: `b5dd47f`, `pnpm verify` — 15 tests, lint/format/types/build.
- V2-001 complete (shared dialogs/tables verified in V2-002): clean reset and reproducible synthetic seed; generated types; `pnpm test:db` 33 assertions; `pnpm verify` 16 tests and production build; `pnpm test:e2e` 8 authenticated journeys across desktop/mobile. Screenshots inspected; no overflow; cross-tenant read and unauthorized approval denied. Commit `35243ae`.

Migrations: foundation `20260914000000`; identity `20260914010000`; brand/catalog `20260914020000`; campaigns `20260914040000`; transactional commands `20260914090000`. Generated types come only from `supabase gen types typescript --local`.

- V2-002 complete: clean reset/types; 59 DB assertions; full verify 19 unit tests; 10/10 authenticated desktop/mobile journeys. Uploaded original PNGs, owner feedback/resubmission/exact approval, immutable package, schedule and confirmed cancel persist; Storage isolation and stale/replay paths pass. Commit `2f5a676`.

- V2-003 complete: clean reset/types; 89 DB assertions; full verify 24 unit tests; 14/14 desktop/mobile journeys. Private ZIP/Drive artifacts, repeat dedupe, corrections, kit/catalog fixtures and readiness verified. Commit `7120cf1`.

- V2-004 complete: clean reset/types; 107 DB assertions; full verify 28 unit tests; 16/16 desktop/mobile journeys. Shared capture dedupe, private rules/playbooks, sandbox previews, evidence thresholds and sequence gaps/false matches verified. Commit `7f54944`.

- V2-005 complete: clean reset/types, 121 DB assertions, full verify 31 unit tests/build; 18/18 real-auth desktop/mobile journeys. Rolling/month and exact weekly generated-copy reviews persist; screenshots inspected and port 3100 closed. Commit recorded after checkpoint.

## Decisions and limits

Required project/build/use-case/UML/design documents read completely; relevant discovery and installed Next.js guides read. Original planning changes preserved. No live provider, old source/database/customer imports, paid AI, pushes, merges or deployment.

Local fixtures have no committed passwords. `scripts/local-runtime.mjs` refuses non-loopback URLs, prepares synthetic accounts using local Auth Admin API, and keeps random credentials in ignored `.audit/local-accounts.json`. `pnpm test:e2e` supplies only local env without modifying the existing `.env.local`.

Brand facts/offers require owner; staff can edit unapproved drafts; platform admin cannot creatively approve. Material changes invalidate affected revisions. Approvals/audit history persist. External provider mode is fake; real classification/vision/design quality, live sending/SMS, production L2 delegation, real suppression and cross-client publication remain disabled/unverified.

## Tracked processes

- Docker application started by this run for local infrastructure; it was initially stopped. No Grey Retention containers existed before the run. Other stopped project containers untouched.
- Supabase project `grey-retention`: task-created disposable local containers; configuration ports 54321–54324, 54327, 8083 (inspect actual listeners at cleanup). `pnpm supabase:stop` at finish; no remote linked project is accessed/reset.
- App/test server port 3100: tracked Playwright sessions ended and port verified closed.
- No active app/test/worker session. Local Supabase remains tracked for subsequent phases.
