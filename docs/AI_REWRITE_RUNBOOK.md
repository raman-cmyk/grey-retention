# AI rewriting and exact copies — setup and operations

Owner flow: brand basics → paste an email → choose **Rewrite for my brand** or **Copy this email** → saved, editable result at `/emails/<id>` → existing owner approval in campaign review. Nothing is sent from this flow.

## Server configuration (names only; never commit values)

| Name                        | Required for        | Notes                                                                                                                                                                                                |
| --------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`            | Rewrite             | Server-only. Missing → owners see "Rewriting is not set up yet"; copy still works. Never use a ChatGPT/Claude subscription login.                                                                    |
| `SUPABASE_SERVICE_ROLE_KEY` | Rewrite             | Server-only. The paid-provider worker RPCs (`claim_/begin_/finish_/fail_email_generation`) execute only as `service_role`. Missing → setup required, no job runs.                                    |
| `OPENAI_REWRITE_MODEL`      | Optional            | Default `gpt-6.1-terra`. Allowed: models with known prices in `features/email-generation/pricing.ts` (`gpt-6.1-terra`, `gpt-6-luna`). Others → setup required.                                       |
| `OPENAI_TIMEOUT_MS`         | Optional            | 5,000–120,000; default 60,000.                                                                                                                                                                       |
| `OPENAI_BASE_URL`           | Tests only          | Unset in production (official `https://api.openai.com/v1`). Only a loopback `http://127.0.0.1`/`localhost` test double is accepted, and never when `NODE_ENV=production`.                            |
| `EMAIL_REWRITE_TENANT_IDS`  | Rewrite (pilot)     | Server-only comma-separated list of exact workspace UUIDs allowed to make real OpenAI requests (at most 50; wildcards and invalid entries are ignored). Empty → no workspace can use real rewriting. |
| `EMAIL_REWRITE_PROVIDER`    | Optional, demo only | `openai` (default) or `sample`. `sample` writes clearly labelled placeholder text ("Sample text (not AI)"), costs nothing, needs the service credential, and is refused in production.               |

`.env.example` lists the public names and defaults (`EMAIL_REWRITE_PROVIDER`, `EMAIL_REWRITE_TENANT_IDS`, `OPENAI_REWRITE_MODEL`, `OPENAI_TIMEOUT_MS`, `OPENAI_BASE_URL`) with `OPENAI_API_KEY` left blank. Real values belong only in the hosting environment's server settings.

## Temporary pilot restriction (not a billing system)

Every workspace automatically gets the synthetic starter package, and any confirmed user can create workspaces, so per-workspace caps alone would let one person multiply server-funded AI allowances. Until commercial packages and billing exist, real OpenAI requests are **denied by default** and allowed only for workspaces listed in `EMAIL_REWRITE_TENANT_IDS`. The check runs on the choose and retry screens and again on every worker attempt before any reservation or provider call, so a removed workspace's queued or retried jobs fail as "setup required" (no cost, no spinning job). A key and service credential alone enable nobody; creating a workspace or holding the synthetic package never grants access. Enabled workspaces still pass every owner, tenant, revision and quota check. Only the loopback test double (never accepted in production) bypasses the list. Copying emails needs no key or entitlement. Not-enabled owners see the generic "Rewriting is not set up yet" message.

## Request contract

Responses API via native `fetch` (`features/email-generation/openai.ts`): `store: false`, strict `json_schema` output (`email_rewrite`), `reasoning.effort: low`, `max_output_tokens` 4,000 (text) or 8,000 (layout rewrite), a hashed `safety_identifier`, a bounded timeout and a 1 MiB response limit. The pasted email is placed only inside a JSON data field and the fixed instructions (`email-rewrite-v1`) tell the model to treat it as untrusted data. The button destination is constrained by schema `enum` to the brand's own links.

## Spend safeguards

- Before each provider request the worker reserves an upper bound: UTF-8 bytes of the full serialized request + 2,000 framing tokens at input price, plus the full output limit (including reasoning) at output price. Requests above 250 KB are refused.
- Reservations use the existing package cycle and daily/cycle caps (`reserve_budget`). Actual cost settles from returned usage; any cost above a reservation is still added to the cycle and flagged.
- A request whose outcome is unknown (timeout, connection reset, 5xx, lost worker) is charged at its full reservation and is **not** retried automatically; the owner decides. Automatic retries happen only when the provider is known not to have charged (429 without usage, DNS/refused connection) plus one repair after a billed malformed output; at most four requests per rewrite.
- Legacy fixture RPCs (`claim_job`, `fail_job`/`onboarding_lease`, `reserve_/reconcile_fixture_usage`) refuse rewrite jobs, leases and reservations.
- Budget alerts for rewrite spend say "including real AI rewriting requests"; fixture wording is unchanged for fixture usage. The only package is still the synthetic starter; live commercial packages are not established.

## Live acceptance checklist (pending)

The hosted app is [grey-retention-app.vercel.app](https://grey-retention-app.vercel.app/get-started). Server-only OpenAI and Supabase credentials and the founder workspace pilot grant are configured. On October 29, 2026, model access was verified and one real rewrite reached OpenAI, which returned `429 credit_balance_exhausted`. The application recorded one dispatch, zero tokens and cost, released the usage reservation, stopped without automatic retry, showed the billing/access message and successfully offered the exact-copy fallback. No successful real-model output exists, so output quality and billed-usage reconciliation remain unverified. The user explicitly chose to leave live rewriting pending; make no more live requests until they ask to resume after funding the API account. No credential values belong in this repository.

When the user resumes live acceptance with API credits available:

1. Confirm the key and service credential are present only in server environment settings, and that a workspace not on the list sees "not set up" with no request made.
2. Rewrite one short synthetic text email and one synthetic HTML email; check subject/body quality, that brand facts are used and no source brand/links/offers leak, and that `email_generations.cost_micro` matches the provider usage page.
3. Confirm refusal/incomplete handling with a deliberately unsuitable source, and a budget refusal with a lowered cap.
4. Review results in two or three real email clients; preview fidelity is not pixel-verified (remote images and fonts are deliberately not loaded in the preview).
