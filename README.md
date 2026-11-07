# Grey Retention

White-label retention campaign operating system. Clean-room MVP built from documented product behavior.

**Plan and work order:** see [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Start

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Default `ADAPTER_MODE=fake` keeps local development independent from Supabase, Klaviyo, Shopify, email, and paid AI providers while foundation work proceeds.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Database commands require Docker and Supabase CLI:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm test:db
pnpm supabase:types
```

## Project contracts

- `PRODUCT.md` — durable product truth
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — milestones M0–M6, work order, and how one issue goes from branch to live
- [`docs/DESIGN.md`](docs/DESIGN.md) — the Grey Retention design language and tokens (applied in milestone M1)
- `DESIGN.md` — the current (older) theme, replaced by `docs/DESIGN.md` during M1
- `docs/SYSTEM_ARCHITECTURE.md` — architecture, NFRs, failure modes, and growth path
- `docs/ARCHITECTURE_BLUEPRINT.md` — technical source of truth
- `docs/adr/` — architecture decision records
- `docs/BUILD_BRIEF.md` — start here (v2 plan, decisions, lanes) and `docs/VISION.md` — the owner's v2 product brief
- `docs/feature-register.json` — all 620 requirements with status
- `docs/archive/` — earlier plans (history only)
- `docs/BUILD_LEDGER.md` — durable cross-task state
