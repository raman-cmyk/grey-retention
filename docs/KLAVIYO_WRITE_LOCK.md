# Klaviyo write lock (KLV-LOCK-001)

The app can never change anything in a Klaviyo account while the write lock is on. The lock is **on by default**, and the code enforces it: no prompt, agent, GROS answer, job, page or database setting can turn it off.

## The rule

**Only a separate, later, explicit instruction from the owner (Raman) may unlock it.** Connecting a full-access Klaviyo key is **not** that instruction. A key with every permission still cannot write while the lock is on.

## What is locked

While locked, the app sends Klaviyo only two kinds of requests:

1. A `GET` (a read) to `https://a.klaviyo.com`, including the next page of a list Klaviyo itself links to.
2. A `POST` of one of these three read-only report questions, at exactly this address:

| Address                        | What it reads                      | Used by                                                                                    |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `/api/campaign-values-reports` | A campaign's opens, clicks, orders | `lib/providers/klaviyo/history.ts` (ONB-103), `lib/providers/klaviyo/results.ts` (LRN-001) |
| `/api/flow-values-reports`     | A flow's numbers                   | `lib/providers/klaviyo/history.ts` (ONB-103)                                               |
| `/api/metric-aggregates`       | A metric's counts (link clicks)    | `lib/providers/klaviyo/results.ts` (LRN-001)                                               |

Klaviyo's API (revision 2026-10-15, the one the client speaks) documents each of the three as a report query that only reads. The list is exact names, never a prefix or a pattern: a name such as `segment-…` could also cover a change.

Everything else is refused with the error `write_locked`, **before any network call**:

- every `PATCH`, `PUT` and `DELETE`;
- every other `POST` (templates, campaigns, campaign messages, images, segments, lists, profiles, send jobs, …);
- every other method (`HEAD`, `OPTIONS`, a lowercase `post`, …);
- any other address: another host or port, `http://`, a user name in the address, a query on a report (`?x=1`), a trailing slash, other letters' case, percent-encoding (`%2f`, `%2d`, `%63`), `.`, `..` or `//` in the path. A report's address must be exactly `https://a.klaviyo.com` followed by one of the three paths above.

A push of a draft ("Create email" with `KLAVIYO_DRAFT_PUSH=live`) stops before it even reads the workspace's key, and the email's build fails as refused (it is not tried again).

## What the app may write once unlocked

Even with the lock released, the client writes only what makes or changes a draft campaign (the campaign, its message and variations, templates and imported pictures) and, since PICK-101, **one segment: GROS's own list-hygiene segment** (`POST /api/segments`, only with a name like `GROS list hygiene · 180 days · v1`, a definition, and nothing starred). It is made once per rule and reused; the app never changes or deletes a segment, and never makes any other one. Nothing it can write schedules or sends.

## How it is enforced (twice)

1. **In the client** (`lib/providers/klaviyo/client.ts`): every request goes through `send()`, which checks the method and the address it is about to send before calling the transport. `write()` checks it first too, so a write of any kind says `write_locked`.
2. **In the transport** (`fetchTransport`, the only code that reaches the network): it checks the method and address again by itself, so code that holds the transport cannot go round the client. It also never sends anything to a host other than `https://a.klaviyo.com`, locked or not (the key goes in the request's header).

The lock is read from the server's environment at every request. Nothing a caller passes (an option, an argument, a setting) can release it.

## What releases it

Only the server environment variable `KLAVIYO_WRITE_LOCK` set to exactly `unlocked`. Missing, empty, spaces around it, `Unlocked`, `true`, `false`, `off`, `0`, `no` or anything else: locked. It is a server-only value (never `NEXT_PUBLIC_…`), listed in `lib/env/server.ts`.

The lock wins over the other switches: `KLAVIYO_MODE=live` (reads from a real account) and `KLAVIYO_DRAFT_PUSH=live` (drafts into Klaviyo) write nothing while it is on. `KLAVIYO_DRAFT_PUSH` stays off.

There is no screen, admin page, database setting, RPC or GROS or agent tool for the lock, and there must never be one.

## The key

The Klaviyo key stays encrypted in the database and is read only by the server jobs that need it. It is never returned to a model, a tool, a log, a chat or the repository. It goes only into the request header to `https://a.klaviyo.com`; error messages name the address's path only, and the logger refuses fields named like a secret or an authorization header.
