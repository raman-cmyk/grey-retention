# Grey Retention v2 build handoff

This is a rolling local checkpoint report. Execution continues sequentially under the unattended-session authorization.

Branch: `codex/grey-retention-v2`, base `b6f92a7`. No pushes, PRs, merges, deployments, live account connections, email/SMS, paid AI or proprietary source/data imports.

## Verified commits

| Task                  | Commit    | Result                                                                                                                                                                                                                                           |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Planning preservation | `bf6f968` | Existing authorized planning documents retained.                                                                                                                                                                                                 |
| V2-000                | `b5dd47f` | Role/version/provider/policy contracts; full verify, 15 unit tests.                                                                                                                                                                              |
| V2-001                | `35243ae` | Persisted brand/catalog/calendar, owner approval and tenant isolation; 33 DB assertions, 8 desktop/mobile journeys. Shared dialog/table remainder completed in V2-002.                                                                           |
| V2-002                | `2f5a676` | Original fixture copy, assigned designer private uploads, owner feedback/resubmission/exact approval, immutable package, durable fixture schedule and confirmed cancel; 59 DB assertions, full verify 19 unit tests, 10 desktop/mobile journeys. |

## Active checkpoint

V2-003 gate passed: private ZIP/import/correction and fixture Drive/commerce/kit behavior persists. Clean reset/types, 89 DB assertions, full verify with 24 unit tests and 14/14 combined desktop/mobile journeys pass. The local checkpoint commit is recorded after creation.

The exact next action is to claim V2-004 in the ledger and implement shared synthetic capture with tenant-private subscriptions/playbooks. V2-004 through V2-010 remain unimplemented at this checkpoint; V2-011 acceptance remains open.

## Schema and verification

Migrations are allocated to their documented namespaces and types are CLI-generated:

- Foundation `20260914000000`; IAM `20260914010000`.
- Brand/AI `20260914020000`–`20260914020002`.
- Jobs/providers/connections `20260914030000`–`20260914030001`.
- Campaigns `20260914040000`; assets `20260914050000`.
- Designers `20260914060000`; notifications `20260914070000`.
- Transactional cross-domain commands `20260914090000`–`20260914090003`.

Commands: `pnpm supabase:reset`, `pnpm supabase:types`, format generated types, `pnpm test:db`, `pnpm verify`, `pnpm test:e2e`. Tests use real local Auth sessions and private Storage, never a linked remote reset. Browser traces/screenshots and sanitized command logs are ignored under `.audit`/`test-results`.

## Capability limits

Persisted application state and role/tenant authorization are real local behavior. AI copy/classification/kit extraction, Drive/commerce connections, notifications/email audits and delivery outcomes are labelled fixtures. No live send has occurred. Real vision accuracy, real-provider acceptance, aesthetic design quality, production L2/delegation, SMS consent, real suppression and cross-client publication remain unverified or disabled. Rescheduling, rendering/assembly, GROS, budgets, results, learning and optimizer acceptance belong to later phases.

## Local environment and tracked processes

Existing `.env.local` is preserved. Test tooling resolves only loopback Supabase, creates random local fixture passwords in ignored `.audit/local-accounts.json`, and supplies local env without printing credentials. Use `pnpm supabase:start` then `pnpm test:e2e` for reproducible local journeys; do not copy fixture credentials or local service keys into source.

Docker was initially stopped and was started for this run. Only task-created `grey-retention` Supabase containers remain active for ongoing database work. Playwright app servers on port 3100 are tracked and stop after each run. Stop local Supabase and verify its listeners and port 3100 are closed when execution finishes. Final cleanup results will be recorded here.
