# ADR-0006: Use one managed hosting baseline

## Status

Accepted

## Context

The MVP needs low operational overhead, preview deployments, managed relational storage, and room to validate product behavior before infrastructure specialization. The user selected Supabase and Vercel as the baseline.

## Decision

Deploy the Next.js application on Vercel and managed data capabilities on Supabase. Use separate local, staging, and production environments. Accept a single-region MVP posture until SLA, geography, or measured failure/latency requirements justify more complexity.

## Consequences

### Positive

- Fast preview and production workflows.
- Low initial platform operations burden.
- Clear ownership between application deployment and managed data services.

### Negative

- Vendor limits, regional outages, and pricing changes affect the product.
- Cross-provider latency and serverless execution limits constrain worker design.
- Stronger recovery and compliance guarantees may require paid tiers.

### Neutral

- Domain and provider contracts stay project-owned to reduce, not eliminate, migration cost.

## Alternatives considered

- Self-hosted Kubernetes: rejected as unnecessary operational complexity.
- AWS-native multi-service stack: viable at larger scale, but slower and costlier for the current team.
- All-in-one Supabase Edge deployment: rejected as the primary web runtime because the chosen Next.js/Vercel workflow is already established.

## References

- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/ARCHITECTURE_BLUEPRINT.md`
