import type { ReactNode } from 'react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { sendFeatureRequest } from '@/features/feedback/actions'
import {
  categories,
  categoryLabel,
  statusLabel
} from '@/features/feedback/rules'
import { formatBrandDate } from '@/lib/brand-time'
import type { SettingsView } from './page-model'
import { Messages, TextBox } from './support-card'

/**
 * Feature requests on Settings (UI-SETd): ask the team for something new,
 * a better way, a fix or anything else, and follow what was asked, latest
 * activity first (Show older lists them all), with its type, status (Open,
 * Planned, Done), the details and the
 * team's replies. Any member sends one; `sendFeatureRequest` checks the
 * session again. BRAND.md has no select or multi-line field: the type and
 * the details are plain controls on the GROS tokens until design gives
 * them a look.
 */
export function RequestsCard({
  view,
  unread
}: {
  view: SettingsView
  /** What the card says when the requests could not be read (or the demo). */
  unread: ReactNode
}) {
  const title = 'Feature requests'
  const requests = view.requests
  const zone = view.timezone?.saved ?? null
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <h2 id="requests" className="type-heading">
            {title}
          </h2>
          {!requests ? (
            unread
          ) : (
            <>
              {requests.items.length === 0 ? (
                <p className="type-body text-[var(--stone)]">
                  No requests yet.
                </p>
              ) : (
                <ul
                  aria-label="Your requests"
                  className="flex flex-col gap-[var(--space-3)]"
                >
                  {requests.items.map((request) => (
                    <li
                      key={request.id}
                      className="gros-tile flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--mist)]"
                    >
                      <div className="flex flex-col gap-[var(--space-1)]">
                        <h3 className="type-body-strong break-words">
                          {request.subject}
                        </h3>
                        <p className="type-caption text-[var(--stone)]">
                          {[
                            request.category
                              ? categoryLabel[request.category]
                              : '',
                            statusLabel[request.status],
                            formatBrandDate(request.createdAt, zone ?? 'UTC') ??
                              ''
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <Messages thread={request} zone={zone} />
                    </li>
                  ))}
                </ul>
              )}
              {requests.more ? (
                <ButtonLink
                  href="/settings?requests=all#requests"
                  label="Show older"
                  kind="quiet"
                />
              ) : null}
              <ActionButton action={sendFeatureRequest} label="Send request">
                <div className="flex flex-col gap-[var(--space-2)]">
                  <label
                    htmlFor="request-category"
                    className="gros-field-label text-[var(--ink)]"
                  >
                    Type
                  </label>
                  <select
                    id="request-category"
                    name="category"
                    defaultValue="feature"
                    className="type-body min-h-[var(--control-sm)] w-full rounded-[var(--radius-md)] border-2 border-transparent bg-[var(--mist)] px-[var(--space-4)] text-[var(--ink)] focus:border-[var(--forest)] focus:bg-[var(--white)] focus:outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}: {c.help}
                      </option>
                    ))}
                  </select>
                </div>
                <Field
                  label="Subject"
                  name="subject"
                  autoComplete="off"
                  maxLength={200}
                  required
                />
                <TextBox
                  id="request-details"
                  label="Details"
                  name="details"
                  rows={4}
                />
              </ActionButton>
            </>
          )}
        </ActionAnswers>
      </div>
    </Card>
  )
}
