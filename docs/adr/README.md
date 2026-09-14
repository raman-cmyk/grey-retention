# Architecture Decision Records

ADRs record decisions that constrain multiple workstreams. They are immutable after acceptance except for status changes and links to superseding ADRs.

| ADR                                                     | Decision                                            | Status   |
| ------------------------------------------------------- | --------------------------------------------------- | -------- |
| [0001](0001-use-a-modular-monolith.md)                  | Use a modular monolith                              | Accepted |
| [0002](0002-use-supabase-postgresql-and-rls.md)         | Use Supabase PostgreSQL and RLS                     | Accepted |
| [0003](0003-use-durable-asynchronous-jobs.md)           | Use durable asynchronous jobs                       | Accepted |
| [0004](0004-isolate-external-providers-behind-ports.md) | Isolate providers behind typed ports                | Accepted |
| [0005](0005-make-white-labeling-data-driven.md)         | Make white-labeling data-driven                     | Accepted |
| [0006](0006-use-one-managed-hosting-baseline.md)        | Use Vercel and Supabase as the MVP hosting baseline | Accepted |

Create the next record with the next four-digit number. Significant changes require a new ADR; do not rewrite the history of the original decision.
