# ADR-0004: Isolate external providers behind typed ports

## Status

Accepted

## Context

The product depends on changing external APIs and may switch AI, email, inbound-mail, commerce, or retention providers. Local development and demos must work without credentials or paid calls.

## Decision

Domain modules depend on project-owned TypeScript interfaces. Each external capability has fake/fixture and real adapters. Provider SDK types and errors are translated at the infrastructure boundary into stable domain records and typed failures.

## Consequences

### Positive

- Demo mode exercises real workflows without external side effects.
- Provider changes stay localized.
- Failure, pagination, timeout, and rate-limit behavior can be tested deterministically.

### Negative

- Adapters add mapping code.
- A lowest-common-denominator interface can hide useful provider features if designed too broadly.
- Contract fixtures must evolve alongside real API behavior.

### Neutral

- Provider-specific capabilities may use narrow extension ports rather than polluting a universal interface.

## Alternatives considered

- Call SDKs directly from routes/domain services: rejected because it couples product logic to vendors and makes fake mode unreliable.
- Build a generic integration engine first: rejected as speculative abstraction.

## References

- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/ARCHITECTURE_BLUEPRINT.md`
