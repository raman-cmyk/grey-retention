# Email file import — setup and operations

Owner flow: **Add an email you like** → choose **Upload a file** (beside **Paste an email**) → pick one `.html`, `.htm`, `.txt` or `.eml` file → the saved email opens on the existing choice, **Copy this email** or **Rewrite for my brand** → saved, versioned result. Optional details (a name) stay closed. Nothing is sent and no AI is used to read the file.

## Server configuration (names only; never commit values)

| Name                        | Required for               | Notes                                                                                                                                                                                     |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY` | File upload                | Server-only. Raw files are written and read by the server worker only. Missing → owners see "File upload is not set up for this workspace yet"; paste and copy keep working.              |
| `EMAIL_IMPORT_TENANT_IDS`   | File upload (hosted pilot) | Server-only comma-separated exact workspace UUIDs (at most 50, no wildcard). Required whenever Storage is not a local loopback stack or `NODE_ENV=production`. Empty → no hosted uploads. |

Root integration added `EMAIL_IMPORT_TENANT_IDS` blank to the public `.env.example`. It is independent of `EMAIL_REWRITE_TENANT_IDS`; enabling uploads grants no AI rewriting and vice versa. No OpenAI key is needed for file import.

## Why a pilot gate

Workspaces are self-created and there are no commercial storage entitlements yet, so hosted raw-file storage is default-deny. The gate is checked before admission, again right before the Storage write, on retries, and on every worker attempt (a removed grant fails queued work as "setup required"). Local loopback development outside production bypasses it.

## Bounds

- Raw file ≤ 4 MiB (4,194,304 bytes: bucket `email-imports` limit, SQL checks, action check, browser hint). This initial internal limit keeps the upload request (plus multipart overhead) and the original-file download under the 4.5 MB request/response body cap of Vercel Functions (https://vercel.com/docs/functions/limitations); it was lowered from an earlier 5 MiB during review. Larger files need direct-to-Storage signed uploads and downloads, tracked as remaining work.
- Decoded email content ≤ 100,000 characters (the existing paste/copy/editor/export bound). Larger content is refused with an explanation, never cut.
- Per workspace: 20 admissions per hour, 200 active file imports, 500 added emails overall, 100 MiB of stored or reserved raw bytes (each distinct file counted once).
- PostalMime limits: nesting depth 20, 256 KiB headers, 200 parts, forwarded messages not inlined (kept as attachments), 200 forwarded addresses.
- Worker: 60-second lease, at most 3 attempts, automatic retry only for temporary storage/server failures; owners may retry those up to 3 times.

## Parsing (PostalMime 4.1.4, pinned)

Chosen because it is maintained, has no runtime dependencies, exposes explicit resource limits, and Mailparser's own documentation marks Mailparser maintenance-only and recommends PostalMime for new code. The single published advisory (GHSA-f2hq-32vh-53cc, quadratic RFC 2047 decoding) affects 3.0.0–4.0.7 and is fixed in 4.0.8. PostalMime handles folded/encoded headers, declared charsets, quoted-printable/base64 and multipart structure; HTML is preferred over text in `multipart/alternative`.

Additions in `features/email-import/parse.ts`: binary/container signatures (ZIP, PDF, images, gzip, RAR, 7z, Outlook `.msg`) are refused; `mbox` files are refused; every declared charset must be decodable (PostalMime would otherwise silently read unknown labels as windows-1252); `.html`/`.txt` files are decoded strictly in browser order — a byte order mark wins, then (HTML only) an explicit `<meta charset>` in the first 1024 bytes (a declared encoding the runtime cannot decode is refused even for ASCII content; a UTF-16 declaration without a BOM means UTF-8), then UTF-8; a `.html`/`.txt` that is really a saved message is asked to be renamed `.eml`. The parser is format-authoritative: a `.txt` file or `text/plain` part stays text even if it contains `<p>`, and an `.html` file stays HTML even without ordinary tags.

Metadata bounds: subject 200, header subject 2,000, sender 400 and download name stems 120 UTF-16 units, shortened with an ellipsis that never splits a surrogate pair (lone surrogates in names become U+FFFD), so every stored value is valid JSON/Postgres text and every download header encodes. Dates outside years 1–9999 are dropped (note `date_unreadable`) instead of failing the email. Bodies and original bytes are never shortened.

Untrusted data rules: nothing is fetched, executed or written by parsing; scripts, forms, remote images and `cid:` images are never loaded (the preview is the existing opaque sandbox); attachments remain only inside the raw file and are counted, not extracted. Subject, sender and date are shown as "as written in the file … not verified" and never treated as captured competitor evidence or verified identity.

## Upload sequence (exactly once, recoverable)

1. The action validates and parses the bytes (nothing stored yet).
2. `admit_email_file_upload` (owner, tenant lock) binds actor + workspace + request key + SHA-256 + kind + size + name, enforces the caps and reserves capacity (10-minute reservation). Identical bytes already admitted are reused.
3. The server writes the bytes to `email-imports/<tenant>/<sha256>.<ext>` (write-once; overlapping writers can only write identical bytes because the path is the hash of the validated bytes).
4. `finalize_email_file_upload` confirms the stored object size and enqueues one `email.import` job.
5. The trusted worker (`claim_/finish_/fail_email_file_import`, service role only) downloads the object, re-verifies size and SHA-256, parses, and saves the decoded source as an owner import linked to the file.

A retry with the same request key resumes at whichever step stopped (lost response, interrupted write, worker restart). An expired reservation without a stored object frees its capacity; reviving it re-checks capacity. Objects are never deleted by this flow, so nothing in use can be removed; storage stays bounded by the caps above. Legacy fixture helpers (`claim_job`, `onboarding_lease` → `fail_job` and fixture finishers) refuse `email.import` jobs.

## Downloads

- `GET /api/v1/email-imports/<importId>/file` and `GET /api/v1/emails/<resultId>/export?part=file`: the exact uploaded bytes, workspace owner/admin only (Storage RLS plus tenant-filtered server reads), re-verified against the frozen hash.
- `part=original` keeps its existing meaning: the decoded email source used for copies and rewrites.
- Headers: `attachment` disposition with a cleaned ASCII name plus UTF-8 form, the file's media type, `nosniff`, `private, no-store`, and `sandbox; default-src 'none'` (repeated in `next.config.ts`, since the app-wide policy would otherwise win). Other workspaces receive 404.

## Remaining (not built in this slice)

Hero-image extraction, inline/attachment image capture or editing, ZIP/mbox/Outlook `.msg`/image imports, UTF-7 and other charsets the runtime cannot decode, S/MIME or PGP messages, deletion/retention controls for uploaded files, files above 4 MiB (needs direct-to-Storage signed upload/download instead of function bodies), upload byte-progress (the UI shows persisted stages), and broader live operational/isolation acceptance (the single-owner hosted smoke below passed).

## Hosted acceptance — October 29, 2026

The tested application from commit `af007a2` is deployed at [grey-retention-app.vercel.app](https://grey-retention-app.vercel.app/get-started) under the user’s Vercel account. The existing Supabase project now has all 45 repository migrations through 90015; identity/workspace row counts were preserved. Only the founder workspace is enabled for hosted uploads and real rewriting; grants stay server-side.

A synthetic EML of exactly 4,194,304 bytes completed the real browser upload → private Storage → trusted worker → Copy/Rewrite choice. The saved size and SHA-256 matched the original; the authenticated original-file download was byte-identical, including the attachment and MIME bytes. The copy fallback after OpenAI rejected an unfunded request saved an exact HTML version. A manual heading/link edit then saved owner-edit Version 2; Version 1 and the original raw file stayed unchanged. Samples remain unapproved, and nothing was sent. This verifies a single-owner hosted happy path, not broad live tenant isolation, load, delivery or email-client fidelity. Local negative/concurrency acceptance is in the ledger.

Account setup limitation: the database remains in `lookitsme’s Org`. The connected user lacks `auth_config_write` / `project_admin_write`, and the Auth URL controls are disabled. The Site URL is still localhost. The project owner/admin must set Site URL to `https://grey-retention-app.vercel.app` and add `https://grey-retention-app.vercel.app/**` to redirect URLs. Existing password sign-in is verified; new sign-up/reset redirects are not ready. Do not disable email confirmation or change permissions to work around this.

Deployment hygiene: `.vercelignore` excludes private local operational artifacts, environment files, test output and build caches. A deployment dry-run checked the 419-file source manifest. Commits use the authenticated GitHub account’s noreply identity in this repository; the previous machine-local email was not associated with an authorized Vercel contributor. GitHub Actions remains disabled; reported checks are local, not remote CI.
