# ADR-0001: Use a modular monolith

## Status

Accepted

## Context

Grey Retention has several business domains but a small initial team, evolving requirements, one web client, and no measured need for independently deployed services. Rapid iteration and consistent tenant authorization matter more than independent scaling.

## Decision

Build one Next.js application organized into explicit domain modules. Route files compose use cases; business logic lives in modules and shared libraries. Modules share PostgreSQL but interact through typed public contracts. Long-running work may execute asynchronously without becoming a separate business service.

## Consequences

### Positive

- One build, deployment, observability path, and authorization model.
- Transactions remain simple across related MVP workflows.
- Domain boundaries allow later extraction when evidence supports it.

### Negative

- A bad deployment can affect every module.
- Database and shared-library coupling require ownership discipline.
- Individual modules cannot scale independently at first.

### Neutral

- Async workers may get a separate deployment later while retaining the same domain contracts.

## Alternatives considered

- Microservices: rejected for MVP because operational and consistency costs exceed current needs.
- Unstructured monolith: rejected because evolving white-label and workflow requirements need enforceable module seams.
- Low-code backend: rejected as the system of record because complex RLS, state machines, jobs, and clean-room ownership need explicit code and migrations.

## References

- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/ARCHITECTURE_BLUEPRINT.md`
