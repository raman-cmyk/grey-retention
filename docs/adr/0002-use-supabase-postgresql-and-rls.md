# ADR-0002: Use Supabase PostgreSQL and RLS

## Status

Accepted

## Context

Campaigns, memberships, prompts, usage ledgers, assignments, synchronized provider records, and audit events are relational and require transactions. The product is multi-tenant and must deny cross-tenant access. The initial team needs managed auth, storage, and database operations.

## Decision

Use Supabase PostgreSQL as the system of record, Supabase Auth for identity, private Supabase Storage for files, and PostgreSQL RLS as mandatory defense in depth. SQL migrations are the schema source of truth. Generated TypeScript types are derived from the database.

## Consequences

### Positive

- ACID transactions and strong relational constraints.
- RLS can enforce tenant boundaries even when application code fails.
- One managed platform covers database, auth, storage, realtime, and initial queue primitives.

### Negative

- Strong dependency on Supabase operational limits and platform behavior.
- RLS policies add testing and query-debugging complexity.
- Horizontal write scaling is not automatic.

### Neutral

- JSONB remains available for bounded flexible payloads but does not replace relational domain fields.

## Alternatives considered

- MongoDB/Firestore: rejected because cross-entity transactions, relational querying, and tenant policy are central.
- Separate Auth0 plus managed PostgreSQL and object storage: viable later, but adds cost and integration work without MVP benefit.
- Application-only tenant filtering: rejected because one missed predicate could expose another tenant's data.

## References

- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/ARCHITECTURE_BLUEPRINT.md`
