# Owner-started AI planning

`STR-LIVE-001` connects the existing Brand pulse, Competitor mapper, Brief
writer, Calendar planner and Strategy critic to the saved planning worker.
It reuses their checks and fallback behavior, the existing lease, the agent
runtime, shared memory, run logs and the metered `runAi` gateway.

## Switch and execution

Paid planning is off by default. Only the exact server value
`STRATEGY_AGENTS=on`, together with ready live models for both `plan` and
`review`, lets the owner's Plan action supply the runtime. A Gemini key or
`EMAIL_BUILD_AGENTS=on` alone does not enable planning. Explicit fake mode,
an absent key or an unpriced model keeps the code-only path.

No live switch is enabled by this implementation. Turning the switch on
requires the owner's separate approval and an authorized live test.

- Existing server actions enforce owner membership before starting work.
- The worker takes tenant identity from its claimed database row.
- Only the workspace's own, non-sample store data uses the injected agents.
  Fallback/sample data never consumes AI.
- The ordinary cron sweep does not supply agents, so it stays code-only.
- The owner still selects offers; actual saved codes, discounts and expiry
  are rechecked, and calendar guards remain authoritative after AI output.
- Every model call reserves cost from the tenant allowance before sending
  and settles usage through the existing budget ledger. Caps are not raised.

## Time and failure behavior

Home and Plan both permit 120 seconds, including their background Server
Actions, and a strategy claim lasts five minutes. The action gives the worker
at most 100 seconds. Each provider call
is capped at 10 seconds; a full call plus 5 seconds of save slack must fit
before another model call starts. The check runs for every call, including
retries and critic rounds, so exhausting time cannot create a paid-call loop.

Refused/unavailable AI, invalid answers or exhausted time use the agents'
existing code fallbacks, with fixed reasons in the fallback log. The saved
pulse/plan preserves `agent` versus `code` source fields; it does not pretend
the critic ran when it was skipped. This change adds no new state or migration.

## Limits still to finish

- The real-store strategy source still needs its competitor library reader;
  wiring an agent does not populate evidence. With no patterns the mapper
  makes no model call and returns no competitor moves.
- Timely paid background continuation is not part of this change. The
  ordinary sweep can finish a waiting plan with rules rather than paid AI.
- No live model quality gate or real-brand end-to-end test has passed from
  this implementation. Tests use synthetic store data and recorded AI replies.
