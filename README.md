# Grey Retention

White-label retention campaign operating system. Clean-room MVP built from documented product behavior.

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
- `DESIGN.md` — generated after Impeccable finish review
- `docs/SYSTEM_ARCHITECTURE.md` — architecture, NFRs, failure modes, and growth path
- `docs/ARCHITECTURE_BLUEPRINT.md` — technical source of truth
- `docs/adr/` — architecture decision records
- `docs/MVP_PLAN.md` — milestones and acceptance gates
- `docs/PARALLEL_TASKS.md` — autonomous workstream prompts
- `docs/BUILD_LEDGER.md` — durable cross-task state
