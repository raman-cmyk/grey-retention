# Read-only Klaviyo testing

`KLV-LOCK-001` adds a server-owned lock at both the shared client and its
real fetch transport. The default is **locked**. No actual account or key
is needed to test the boundary.

- Missing, empty or malformed `KLAVIYO_WRITE_LOCK` stays locked. Only the
  exact value `unlocked` permits the existing restricted draft mutations.
- A full-access API key does not authorize writes. Neither
  `KLAVIYO_MODE=live` nor `KLAVIYO_DRAFT_PUSH=live` bypasses the lock.
- Unlocking needs a separate owner instruction and server configuration
  change. There is no browser/request switch or model tool to unlock it.
- Keep `KLAVIYO_DRAFT_PUSH=off` during read-only testing. This change does
  not change any production setting, connect an account, or unlock anything.

## Allowed while locked

Bounded GET reads on the canonical `https://a.klaviyo.com/api/` origin,
including normal trailing slashes and encoded pagination query parameters.
GET requests must not have a body.

Exactly three POST paths are allowed because Klaviyo uses them for read-only
analytics. Current callers send their query in the JSON body; POST URL query
strings are not allowed by this testing contract:

| Exact path                     | Klaviyo reference                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `/api/campaign-values-reports` | [Query Campaign Values](https://developers.klaviyo.com/en/reference/query_campaign_values)     |
| `/api/flow-values-reports`     | [Query Flow Values](https://developers.klaviyo.com/en/reference/query_flow_values)             |
| `/api/metric-aggregates`       | [Query Metric Aggregates](https://developers.klaviyo.com/en/reference/query_metric_aggregates) |

No prefix, wildcard or additional report endpoint is implicitly allowed.
Unknown methods, look-alike paths, encoded path characters, traversal,
credentials in URLs, alternate origins/ports and fragments are refused.
URL length is capped at 8,192 characters and path length at 2,048.

## Refusals and verification

Mutations fail with `KlaviyoError('write_locked')` before transport. The draft
pusher returns a final refusal with the fixed reason `testing_write_lock`,
so a configuration lock is not misreported as an outage or retried as one.
The lock is checked on each retry as well as at the fetch boundary.

Even when explicitly unlocked, raw fetch calls keep the same draft-only
method/path restriction and refuse schedule-bearing payloads. Sending,
scheduling and profile/list/segment changes remain outside that contract.

`lib/providers/klaviyo/write-lock.test.ts` uses only a synthetic key,
recorded transports and fetch spies. It proves zero write calls with both
live flags enabled, legitimate reads/reports, fail-closed settings, direct
transport protection, path/URL adversarial cases and relocking during a
rate-limit retry. Existing draft/pusher suites explicitly unlock only their
synthetic tests; the general test setup does not unlock the application.

Audit: the live catalog, history, results, key checks and draft adapters all
use `klaviyoClient`; actual Klaviyo HTTP goes through `fetchTransport`.
No additional live network path was found in this change's source review.
