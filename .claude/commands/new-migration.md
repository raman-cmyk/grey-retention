---
description: Create the next correctly numbered Supabase migration for a domain range.
argument-hint: <domain> <short_snake_case_name>
---

Create a new migration for: **$ARGUMENTS**

Domain ranges (two digits after `20260914`):

| Domain keyword                  | Range |
| ------------------------------- | ----- |
| foundation                      | `00`  |
| iam                             | `01`  |
| ai, brand, gros                 | `02`  |
| integrations, jobs, klaviyo     | `03`  |
| campaigns, calendar             | `04`  |
| references, templates           | `05`  |
| designers                       | `06`  |
| support, team, settings         | `07`  |
| operations, packages, reports   | `08`  |
| integration (cross-domain only) | `09`  |

Steps:

1. Map the domain keyword to its range. If it is unclear, ask. **Then use range `09` anyway** unless your number would still sort after the newest migration on the hosted project: it already has everything up to `20260914090016`, and Supabase refuses older versions (see Migration allocation in `docs/BUILD_LEDGER.md`).
2. List `supabase/migrations/` for files starting with `20260914<range>` and take the highest four-digit sequence. Also check the **Migration allocation** section of `docs/BUILD_LEDGER.md` and any open branches you know of for numbers already reserved.
3. Create `supabase/migrations/20260914<range><next sequence, zero-padded to 4>_<short_name>.sql` with a header comment naming the task ID and purpose.
4. Remind yourself of the rules: RLS enabled on every new table; tenant-scoped policies; business conflicts raise `PT409`, never SQLSTATE `40001`; lock tenant before campaign/job/usage rows; no hardcoded tenant or user IDs outside seed fixtures.
5. Add or extend a pgTAP test in `supabase/tests/` covering the new policies, including a foreign-tenant denial.
6. Record the number under **Migration allocation** in `docs/BUILD_LEDGER.md`.
