# Human-curated Observer source

The Observer Sheet is authoritative for human email ratings. In selected-source mode GROS reads only effective exact **Exemplary** approvals with a named reviewer. Good, explicitly unreviewed, duplicate-ID, malformed, identified confirmation and transactional rows are excluded. Models do not decide admission.

## Brand defaults and individual overrides

Owner decision, 27 November 2026: a named human brand rating applies to existing and future collected newsletter emails, unless an individual email has a nonblank rating. The new Brand ratings tab uses schema `observer-brand-review-v1`, with header row 6 and records from row 7: A Brand ID, B Domain, C Brand rating, D Reviewer, E Review notes, F Collected emails, G Open brand emails, H Data issue, I Schema version. C:E are human-owned. Observer appends stable brand identities without overwriting these cells.

The server joins by both immutable Brand ID and exact domain, rejects duplicate IDs/domains and malformed schemas, and independently computes effective approval. A nonblank email rating always takes precedence, including Good, Unreviewed or an invalid legacy input. An explicit Exemplary override needs its own reviewer and may qualify even when the brand default is Good. A blank email rating inherits the brand rating and its reviewer; an unrelated email reviewer cell does not create an override. Missing brand tabs preserve the earlier explicit-email mode; a present but unreadable/malformed source fails closed. Source values are read fresh before/after Gmail retrieval and on display/reuse. Only grid bounds are reused per source instance to reduce API requests; email and brand values are batched and never cached across source reads.

Downgrading/deleting a brand approval withdraws its inherited emails, while explicit human Exemplary exceptions remain eligible. Identified confirmation/transactional rows are excluded in either mode. Unclassified does not establish message type or quality; approving a brand delegates admission of otherwise eligible unclassified newsletter records. It is not a conversion-performance verdict.

Observer v1.5.0 exports and repairs derived Effective rating, Rating source, Effective reviewer and Review issue in Email review W:Z and uses them for the Sheet's derived queue. Original A:V schema headers remain compatible. The server uses original inputs, never these formulas. Dropdowns and body formatting are restored after atomic appends, avoiding inherited header styling and missing validation. Existing invalid inputs are preserved and flagged, not silently mapped to ratings.

## Enable after review and deployment

1. Deploy the Observer release that populates the Sheet's **Email review** tab. The schema marker is `observer-email-review-v1`. Human inputs are M:Q; GROS uses M (rating) and N (reviewer) and independently validates source identity. Do not put credentials or original email HTML in the workbook.
2. Apply this PR's additive curated-follow migration, renumbered to the next available migration at merge per D24. It keeps owner authority, the ten-followed-brand cap, subscription revisions and RLS. A real brand must already have an original admitted by the Observer worker before it can be followed.
3. In the existing GROS server deployment, keep the existing `INBOX_IMAP_USER` and `INBOX_IMAP_APP_PASSWORD` configuration. The selected-source transport uses that Gmail directly with read-only mailbox locks and PEEK fetches; it does not require another receiving inbox or a Gmail OAuth flow.
4. Add these private server variables through the hosting provider's secret editor: `OBSERVER_SPREADSHEET_ID` (the existing workbook ID), `OBSERVER_SHEETS_SERVICE_ACCOUNT` (the service-account JSON for that workbook), and `OBSERVER_SOURCE=sheet`. No `NEXT_PUBLIC_` variable is used. The service account needs access to the specific Sheet; the reader requests the Sheets read-only scope. Never paste keys in chat or commit real values. An explicit `INBOX_TRANSPORT=fake` remains sample-only; remove it for the real deployment.
5. Run the existing scheduled inbox job. GROS selects older or newer approved messages by exact Gmail message ID or exact Message-ID across All Mail, Spam and Trash. It verifies original recipient and sender before the existing private archive/image/screenshot/tagging pipeline receives MIME. Missing originals are skipped in bounded scans. No subscriptions, sends, mailbox read marks, deletes or account changes are made by this source.
6. On Inspiration, the workspace owner can Follow a real domain that currently has an Exemplary selection and has finished its initial inbox import. This selects which brands are relevant to that workspace; it does not subscribe to their newsletter or launch another capture job. The existing followed-brand and hidden-brand rules still apply. The admin inbox holds the full curated intake; client libraries show their followed brands.

The selection database stays in the Sheet. Existing GROS database rows, private assets and labels are derived processing records. A changed selection resets the selected-set cursor, with original-message deduplication preventing duplicate records. Source fields and ratings are never written back by GROS.

## Withdrawal and outages

Changing Exemplary to Good/unreviewed, deleting a row or introducing a duplicate ID removes eligibility on the next source read. Inspiration/library reads, the Use this design page, studio reference reads and library-copy authorization recheck current selection. Provider outages fail closed for real Observer-sourced references; previously archived originals are retained. Unrelated private uploads and explicit synthetic examples are unaffected. Already-generated client work is not retroactively deleted.

Do not turn the mode back off as an outage workaround: legacy inbox behavior is intentionally retained only for an explicit pre-activation rollout, not as a selected-mode fallback. Keep the flag on and fix the reported source configuration or provider problem.

## Acceptance before live use

- Human rates one neutral test email Exemplary and enters their name. It is imported once, assigned to the intended brand and appears for a workspace following that brand.
- An old Gmail message rated later is imported, even though its arrival UID is behind the old inbox cursor.
- Good/unreviewed messages are neither downloaded into the processing pipeline nor shown as Observer references.
- Downgrade the selected email: it disappears from the next library/use read without deleting its private original.
- Verify no live unsubscribe/preference/tracking links work in the existing sanitized previews and that screenshots/images remain private.
- Missing credentials or an inaccessible Sheet gives a source error; it must not start scanning the whole mailbox.

No live secret, deployment, mailbox or paid AI setting is changed by this PR. Automated tests use fictional brands, generated signing keys and fake Gmail/Sheets adapters. Local database execution requires Docker; run the Supabase reset/database suite in CI before merge if Docker is unavailable locally. Live Gmail and full browser acceptance are activation checks, not established by mocks.
