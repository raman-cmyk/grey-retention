# V2 build progress

Checkpoint: October 4, 2026. Branch `codex/grey-retention-v2`; base `b6f92a7`.

## Active task

V2-000–V2-011 eligible local fixture gates complete. Integration checkpoint `0bb2a3e`; final handoff/cleanup documentation follows it. Branch remains local and the working tree is clean after the final documentation commit. Clean reset/types/seed, 332 DB assertions, full verify (47 unit tests, format/lint/types/build), all 38 authenticated desktop/mobile journeys and actual completion/privacy/budget concurrency proofs pass. Admin escalation preserves owner creative approval; private/shared GROS rechecks visibility under locks. No task-started server, worker or Docker container remains running; all configured ports closed. See `docs/BUILD_HANDOFF.md` for commits/migrations, startup, acceptance mapping and external blockers. Exact next action: local production-rendering/provider/evaluation acceptance specification, with live transport and production L2/design delegation still disabled. No agents, live providers, push, PR, merge or deployment.

## Checkpoints

- Planning preserved: `bf6f968`.
- V2-000 complete: `b5dd47f`, `pnpm verify` — 15 tests, lint/format/types/build.
- V2-001 complete (shared dialogs/tables verified in V2-002): clean reset and reproducible synthetic seed; generated types; `pnpm test:db` 33 assertions; `pnpm verify` 16 tests and production build; `pnpm test:e2e` 8 authenticated journeys across desktop/mobile. Screenshots inspected; no overflow; cross-tenant read and unauthorized approval denied. Commit `35243ae`.

Migrations: foundation `20260914000000`; identity `20260914010000`; brand/catalog `20260914020000`; campaigns `20260914040000`; transactional commands `20260914090000`. Generated types come only from `supabase gen types typescript --local`.

- V2-002 complete: clean reset/types; 59 DB assertions; full verify 19 unit tests; 10/10 authenticated desktop/mobile journeys. Uploaded original PNGs, owner feedback/resubmission/exact approval, immutable package, schedule and confirmed cancel persist; Storage isolation and stale/replay paths pass. Commit `2f5a676`.

- V2-003 complete: clean reset/types; 89 DB assertions; full verify 24 unit tests; 14/14 desktop/mobile journeys. Private ZIP/Drive artifacts, repeat dedupe, corrections, kit/catalog fixtures and readiness verified. Commit `7120cf1`.

- V2-004 complete: clean reset/types; 107 DB assertions; full verify 28 unit tests; 16/16 desktop/mobile journeys. Shared capture dedupe, private rules/playbooks, sandbox previews, evidence thresholds and sequence gaps/false matches verified. Commit `7f54944`.

- V2-005 complete: clean reset/types, 121 DB assertions, full verify 31 unit tests/build; 18/18 real-auth desktop/mobile journeys. Rolling/month and exact weekly generated-copy reviews persist; screenshots inspected and port 3100 closed. Commit `cdeb997`.

- V2-006 complete: clean reset/types, 145 DB assertions, full verify 35 unit tests/build, 20/20 combined browser journeys and 2/2 focused rechecks. Private real SVG artifacts, scoped inspiration, focused revisions, exact owner review and immutable assembly persist. Token-redacting runner verified; port 3100 closed. Commit `bab8d1c`.

- V2-007 complete: final clean reset, 191 DB assertions (100 snapshot-exact fixture pushes), full verify 37 unit tests/build; 22/22 browser journeys plus 2/2 text-preview reload checks. Mobile delivery also exercised the added server reconciliation guard. Preview/screenshots inspected; port 3100 closed. Commit `3b7d554`.

- V2-008 complete: `0f12322`; clean reset, 229 DB assertions, concurrent budget proof, full verify 37 tests/build, 28/28 browser journeys.

- V2-009 complete: `dfed204`; clean reset, 269 DB assertions, full verify 40 tests/build; 28 existing journeys plus 2/2 corrected reporting journeys.

- V2-010 complete: `5e77cfe`; clean reset/types, 302 DB assertions, full verify 43 tests/build, full 34/34 browser journeys.

- V2-011 complete (eligible fixture gate): `0bb2a3e`; final clean reset/types and 332 assertions; full verify 47 tests/build; 38/38 browser journeys; actual concurrent completion, forced visibility and budget proofs; client/log scan, screenshots, keyboard and cleanup checks passed. Whole production v2 remains externally unverified.

## Decisions and limits

Required project/build/use-case/UML/design documents read completely; relevant discovery and installed Next.js guides read. Original planning changes preserved. No live provider, old source/database/customer imports, paid AI, pushes, merges or deployment.

Local fixtures have no committed passwords. `scripts/local-runtime.mjs` refuses non-loopback URLs, prepares synthetic accounts using local Auth Admin API, and keeps random credentials in ignored `.audit/local-accounts.json`. `pnpm test:e2e` supplies only local env without modifying the existing `.env.local`.

Brand facts/offers require owner; staff can edit unapproved drafts; platform admin cannot creatively approve. Material changes invalidate affected revisions. Approvals/audit history persist. External provider mode is fake; real classification/vision/design quality, live sending/SMS, production L2 delegation, real suppression and cross-client publication remain disabled/unverified.

## Tracked processes

None remain active. Final pipeline session 90673 ended successfully. Interrupted browser sessions were stopped with descendant cleanup; final normal runner closed port 3100. `pnpm supabase:stop` (session 35881, finished) stopped all task-created `grey-retention` containers and retained disposable local backups. No Docker containers were running afterward; task-started Docker Desktop was stopped with its CLI (session 88471, completed), and backend/UI processes are gone, restoring its initial stopped state. Previously stopped unrelated containers were untouched. No task-owned Next/Playwright/proof process remains. Ports 3100, 54320–54324, 54327, 54329 and 8083 all tested closed; proof saved in ignored `.audit/cleanup-ports-v2-011.json`.
