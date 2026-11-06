# Main product review and UI polish

Reviewed October 4, 2026 on `codex/grey-retention-v2`, task UI-002.

The local, persisted owner campaign loop is implemented. It remains a fixture product rather than a production release. This review checked the source against the build handoff, use cases and architecture, then inspected the client, admin and designer surfaces. It preserves the neutral Inter/graphite/blue visual direction.

## Changes in this review

- Replaced the proof-list overview with campaign progress, actionable review queues, production/scheduling counts, brand foundation links, working filters and ten-row pagination. Counts come from the authorized workspace; they are not revenue or performance claims.
- Added a real tenant-timezone monthly calendar, weekday/day placement, previous/next/Today controls, dated mobile agenda and distinct List/History views. Calendar month and view survive navigation; impossible months fall back safely.
- Grouped main navigation and surfaced Assets and Copy review. Added functioning page search with keyboard shortcuts, an authenticated profile menu and mobile sign-out. Removed the false unread count and inert workspace switcher. The mobile drawer scrolls within the viewport and supports Escape/focus return.
- Improved shared heading, panel, table, notice and form-feedback hierarchy, with loading skeletons and recoverable error boundaries in every role workspace.
- Added campaign workflow status/jump navigation that prioritizes reopened calendar approval, compact asset browsing with classification disclosures, and clearer GROS conversations/messages/proposal disclosures. Reference choices now use readable labels.
- Replaced placeholder buttons with an honest planned-state and a working Operations link. Designer Help now explains the actual assignment/revision/owner-review workflow.
- Fixed weekly date validation and tenant-timezone expiry formatting. Empty weekly reviews now explain the next step.
- Fixed false detail-page 404s caused by capped collection lookups. Campaign and reference details are queried directly under authorization; campaign/reference collections use stable scoped pages and surface failed reads.
- Fixed incompatible structure source/type selections. A unified picker submits the existing typed action fields together; library, rendering and GROS reference options are restricted to the current tenant's active subscriptions in addition to RLS.

No dependencies, database migrations, provider transport, approval authority or action payload contracts were changed. Shared additions are a scoped pagination utility and optional presentation props on Panel.

## What is still missing

| Priority                   | Gap                                 | Current behavior / needed follow-up                                                                                                                                                                                                                                                                                             |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High                       | Catalog, offer and event correction | Product/offer/event creation is implemented, but saved product details cannot be edited, offers cannot be deactivated, and mistaken events cannot be removed. Add exact-version mutation commands, approval invalidation and authorization/failure tests. See `features/brand/actions.ts` and `features/operations/actions.ts`. |
| High                       | Complete admin console              | Admin Overview, Clients, Prompt engine and platform Templates remain planned surfaces. Packages, budgets, provider health, jobs and design assignment/escalation have working local tools. Implement the remaining roster/detail/governance/curation workflows rather than treating placeholders as completion.                 |
| High before production     | Provider transport and email output | Live Klaviyo, Shopify, Drive, inbound mail and AI remain disabled. Production hosted/raster artifacts, email-client compatibility, provider acceptance, consent/segment definitions and real classification/design quality still require separate acceptance work. Fixture correctness does not verify these.                   |
| Medium                     | Friendly date/time editing          | Calendar/read views honor tenant timezones, but several mutation forms still ask for ISO UTC strings. Introduce tenant-local controls with tested timezone/DST conversion across campaign creation, offers, planning and rescheduling.                                                                                          |
| Medium                     | Notification and support operations | Campaign notifications are visible in campaign history; a global read/unread inbox is not implemented. Broader feedback triage, attachment and platform support tooling remains incomplete.                                                                                                                                     |
| Medium                     | Representative scale and usability  | Intake remains bounded to 100 files per batch. The 500-image target, vision accuracy target, measured onboarding/review times and representative accessibility/usability still need acceptance. Collection paging removes the 1,000-row cutoff but is not a load test or a virtualized gallery.                                 |
| Separate product decisions | Extended automation/publication     | Production L2/design delegation, SMS, live suppression/reversal, public archive and cross-client publication remain disabled or deferred by the existing architecture.                                                                                                                                                          |

## Verification

- `pnpm verify`: formatting, lint, typecheck, 80/80 unit tests across 30 files and production build passed. The final browser selector/timing updates also passed targeted formatting/lint and full typecheck.
- Fresh isolated database acceptance: 332/332 SQL assertions across 14 files passed before browser fixture mutations.
- Full authenticated browser acceptance: 46/46 desktop/mobile journeys passed using the normal Next.js/Turbopack runtime. This includes the owner/designer revision loop, permissions, persisted fixture delivery, source reuse, learning, keyboard navigation, short-screen sign-out, calendar views and invalid weekly dates.
- An additional six focused desktop/mobile UI checks passed against the preserved existing preview. Synthetic screenshots were inspected for hierarchy and overflow.

The UI-002 handoff entry in `BUILD_LEDGER.md` records the final cleanup and limitations. Local logs and original synthetic screenshots are in ignored `.audit/`; that directory also contains private local credentials and must not be published.

The pre-existing local preview at `http://127.0.0.1:3100` and its Supabase stack were preserved. A separate disposable stack is used for full fixture acceptance and stopped afterward. No external provider was connected, no email was sent, and no deployment/push/merge was performed.

## October 28 follow-up: onboarding first (ONB-001)

The first-use UI now starts with one visible workspace question. Workspace address and device timezone are suggested and remain editable in a disclosure; server errors reopen those details and preserve typed values. The shared authentication shell is a centered form rather than a decorative split dashboard.

New workspaces enter `/get-started`. This authorized guide derives progress from the current tenant's saved brand, active-subscription email evidence and campaigns. Owners can save brand basics and optional voice/rules with the existing revision-checked command; staff see guidance instead of editing controls. Saved rules are preserved when revisiting setup. Saving does not approve a brand version or relax any sending requirement.

The sidebar keeps the competitor → references → campaign workflow visible, with additional tools and account management in expandable groups. The active group opens automatically. Search results stay fully expanded. Empty workspaces receive a direct setup entry point.

This is the first simplification slice. Reference capture still uses fictional `.example` sources; setup hands off to the existing competitor/library/calendar screens. Automatic website extraction, real competitor collection, exact visual reconstruction, a dedicated first-draft composer and measured first-session usability remain future work. The guide says this directly; it does not display fabricated scan progress or successful live connections.

Verification is recorded in the ONB-001 ledger handoff. No dependency, database migration, provider transport or approval authority changed.
