import type { ReactNode } from 'react'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { AppPage, CardRow, defaultAssistant } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { formatBrandDate } from '@/lib/brand-time'
import type { BookLines, BrandBookView } from './book-view'
import type { BrandBookPageView } from './page-model'
import { ApproveCard, brandBookHref, brandHref } from './screen'

/**
 * Brand book (UI-BRAND), a GROS page under Brand at
 * `/settings/brand/book`: what the agents read about the brand, for the
 * owner to review before he approves his brand. The confirmed parts (the
 * facts true on every source, his own approved words) are kept apart from
 * what the readers saw and from the Brand strategist's reading, which are
 * shown as what they are, never as facts (as the agents are told,
 * `brandBookHeader`). The approval is the Brand page's own, for exactly the
 * version shown. Read only: corrections to the book have no screen yet.
 */
export function BrandBookScreen({
  view,
  assistant = defaultAssistant
}: {
  view: BrandBookPageView
  assistant?: string
}) {
  return (
    <AppPage current="settings" title="Brand book" assistant={assistant}>
      <div>
        <ButtonLink href={brandHref} label="Back to Brand" kind="quiet" />
      </div>
      {view.state === 'error' ? (
        <ErrorState
          title="Brand book did not open"
          reason={view.reason}
          action={<ButtonLink href={brandBookHref} label="Try again" />}
        />
      ) : !view.book ? (
        <>
          <EmptyState
            title="No Brand book yet"
            action={<ButtonLink href="/setup" label="Open setup" />}
          />
          <ApproveCard
            brand={view.brand}
            owner={view.owner}
            assistant={assistant}
          />
        </>
      ) : (
        <Book
          book={view.book}
          view={view}
          assistant={assistant}
          timezone={view.timezone}
        />
      )}
    </AppPage>
  )
}

function Book({
  book,
  view,
  assistant,
  timezone
}: {
  book: BrandBookView
  view: Extract<BrandBookPageView, { state: 'ready' }>
  assistant: string
  timezone: string
}) {
  return (
    <>
      <CardRow>
        <ApproveCard
          brand={view.brand}
          owner={view.owner}
          assistant={assistant}
        />
        <Section title="This version">
          <div className="flex flex-col gap-[var(--space-1)]">
            <p className="type-label text-[var(--stone)]">Version</p>
            <p className="type-number-lg">{book.version}</p>
          </div>
          <p className="type-body text-[var(--stone)]">
            {[
              `Written ${formatBrandDate(book.writtenAt, timezone) ?? ''}`.trim(),
              book.brandName,
              book.site
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {book.sample ? (
            <p className="type-body">
              Made from sample data. Nothing here comes from a real store.
            </p>
          ) : null}
          {book.sources.length ? (
            <p className="type-caption text-[var(--stone)]">
              Read from: {book.sources.join(', ')}
            </p>
          ) : null}
          {book.corrected.length ? (
            <p className="type-caption text-[var(--stone)]">
              You corrected: {book.corrected.join(', ')}
            </p>
          ) : null}
        </Section>
      </CardRow>
      <CardRow>
        <Section title="Confirmed facts">
          <p className="type-caption text-[var(--stone)]">
            True on every source {assistant} read. {assistant} never writes
            against them.
          </p>
          {book.facts.length ? (
            <Items items={book.facts} label="Confirmed facts" />
          ) : (
            <p className="type-body text-[var(--stone)]">
              No fact is confirmed yet, so {assistant} claims none.
            </p>
          )}
          {book.unclear.length ? (
            <Group
              group={{ label: 'Not clear', lines: book.unclear }}
              note={`Your sources disagree on these, so ${assistant} makes no claim about them.`}
            />
          ) : null}
        </Section>
        <Section title="Your words">
          {book.owner === null ? (
            <p className="type-body text-[var(--stone)]">
              Not in this version. Approve your brand, and {assistant} adds your
              words the next time it writes the book.
            </p>
          ) : book.owner.length === 0 ? (
            <p className="type-body text-[var(--stone)]">
              You approved your brand with no positioning, voice or rules yet.
            </p>
          ) : (
            <dl className="flex flex-col gap-[var(--space-4)]">
              {book.owner.map((line) => (
                <div
                  key={line.label}
                  className="flex flex-col gap-[var(--space-1)]"
                >
                  <dt className="type-label text-[var(--stone)]">
                    {line.label}
                  </dt>
                  <dd className="type-body break-words whitespace-pre-wrap">
                    {line.text}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
      </CardRow>
      <CardRow>
        <Section title={`What ${assistant} saw`}>
          <p className="type-caption text-[var(--stone)]">
            Seen on your pages, emails and reviews. Used for tone and ideas,
            never stated as a fact.
          </p>
          {book.seen.length || book.sending ? (
            <>
              {book.seen.map((group) => (
                <Group key={group.label} group={group} />
              ))}
              {book.sending ? (
                <Group
                  group={{ label: 'How you send today', lines: [book.sending] }}
                />
              ) : null}
            </>
          ) : (
            <p className="type-body text-[var(--stone)]">Nothing seen yet.</p>
          )}
        </Section>
        <Section title="Products">
          {book.products.count !== null ? (
            <div className="flex flex-col gap-[var(--space-1)]">
              <p className="type-label text-[var(--stone)]">
                Products to feature
              </p>
              <p className="type-number-lg">{book.products.count}</p>
            </div>
          ) : null}
          {book.products.bestsellers.length ? (
            <Group
              group={{
                label: 'Best sellers',
                lines: book.products.bestsellers
              }}
            />
          ) : null}
          {book.products.newArrivals.length ? (
            <Group
              group={{
                label: 'New arrivals',
                lines: book.products.newArrivals
              }}
            />
          ) : null}
          {!book.products.bestsellers.length &&
          !book.products.newArrivals.length ? (
            <p className="type-body text-[var(--stone)]">
              No best sellers or new arrivals read yet.
            </p>
          ) : null}
        </Section>
      </CardRow>
      <CardRow>
        <Section title="Strategist’s reading">
          <p className="type-caption text-[var(--stone)]">
            A reading of this book, not a fact. It never comes before the facts,
            your words or what to avoid.
          </p>
          {book.reading ? (
            <>
              {book.reading.positioning ? (
                <Group
                  group={{
                    label: 'Positioning',
                    lines: [book.reading.positioning]
                  }}
                />
              ) : null}
              {book.reading.parts.map((group) => (
                <Group key={group.label} group={group} />
              ))}
              {book.reading.voice.map((group) => (
                <Group key={group.label} group={group} />
              ))}
              {book.reading.style ? (
                <Group
                  group={{
                    label: 'How sentences are written',
                    lines: [book.reading.style]
                  }}
                />
              ) : null}
            </>
          ) : (
            <p className="type-body text-[var(--stone)]">
              Not read yet. The strategist reads each new version of the book.
            </p>
          )}
        </Section>
        <Section title="What to avoid">
          {book.avoid.length ? (
            <Items items={book.avoid} label="What to avoid" />
          ) : (
            <p className="type-body text-[var(--stone)]">
              No claims are off limits for this kind of store.
            </p>
          )}
        </Section>
      </CardRow>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {children}
      </div>
    </Card>
  )
}

function Items({ items, label }: { items: string[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-[var(--space-2)]">
      {items.map((item, i) => (
        <li key={i} className="type-body break-words">
          {item}
        </li>
      ))}
    </ul>
  )
}

function Group({ group, note }: { group: BookLines; note?: string }) {
  return (
    <div className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--mist)] px-[var(--space-4)] py-[var(--space-4)]">
      <p className="type-label text-[var(--stone)]">{group.label}</p>
      {note ? <p className="type-caption text-[var(--stone)]">{note}</p> : null}
      <Items items={group.lines} label={group.label} />
    </div>
  )
}
