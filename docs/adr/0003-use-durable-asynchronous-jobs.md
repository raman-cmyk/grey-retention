# ADR-0003: Use durable asynchronous jobs

## Status

Accepted

## Context

Klaviyo/Shopify synchronization, AI generation, inbound-email processing, notifications, and stale-work recovery can exceed request limits or fail transiently. Vercel requests and cron delivery must not be assumed to execute exactly once.

## Decision

Persist operation intent and execute long-running work through durable jobs using Supabase queue/cron primitives initially. Jobs use idempotency keys, leases, heartbeats, bounded attempts, exponential backoff with jitter, checkpointed cursors, dead-letter outcomes, and sanitized diagnostics.

## Consequences

### Positive

- Browser and server request timeouts do not lose accepted work.
- Retries and partial progress are explicit and diagnosable.
- At-least-once provider/webhook delivery becomes safe.

### Negative

- Results are eventually consistent.
- Job state, recovery, and idempotency increase implementation effort.
- Supabase queue limits may eventually require a dedicated worker platform.

### Neutral

- Web and worker deployment may be separated later without changing domain job contracts.

## Alternatives considered

- Run provider work inside user requests: rejected due to timeout and retry risk.
- In-memory queue: rejected because deploys and crashes lose work.
- Kafka or a dedicated broker at MVP: rejected as operationally disproportionate.

## References

- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/ARCHITECTURE_BLUEPRINT.md`
