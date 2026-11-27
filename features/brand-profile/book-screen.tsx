import type { ReactNode } from 'react'
import { ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { AppPage, CardRow, defaultAssistant } from '@/components/gros/nav'
import { Progress } from '@/components/gros/progress'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { Status } from '@/components/gros/status'
import { KeepFresh } from '@/features/strategy/refresh'
import { formatBrandDate } from '@/lib/brand-time'
import { retryBrandBookRewrite } from './book-actions'
import {
  CorrectionsList,
  DesignForm,
  FactsForm,
  OwnMark,
  SeenGroups
} from './book-corrections'
import { sourceText } from './book-design'
import type { BookLines, BrandBookView } from './book-view'
import type { BrandBookPageView } from './page-model'
import { rewriteSteps, type RewriteState } from './rewrite-view'
import { brandBookHref, brandHref, brandVersionHref } from './screen'

/**
 * Brand book (UI-BRAND), a GROS page under Brand at `/brand/book`
 * (UI-BRAND-2): what the agents read about the brand. The confirmed parts
 * (the facts true on every source, the owner's own approved words) are
 * kept apart from what the readers saw and from the Brand strategist's
 * reading, which are shown as what they are, never as facts (as the
 * agents are told, `brandBookHeader`): the confirmed parts first, the
 * reading last. The owner approves his brand on Brand, where he sees what
 * he approves; this page links there.
 *
 * UI-BRAND-2: the owner types corrections straight into the book (a line
 * of what GROS saw, a confirmed fact, a line of his own); a correction is
 * his own word, marked "Your correction", and the book is rewritten right
 * away. While a rewrite runs, the page says so, reads itself again and
 * holds its correction buttons; a failed rewrite shows Try again.
 */
export function BrandBookScreen({
  view,
  assistant = defaultAssistant
}: {
  view: BrandBookPageView
  assistant?: string
}) {
  return (
    <AppPage current="brand" title="Brand book" assistant={assistant}>
      <div>
        <ButtonLink href={brandHref} label="Back to Brand" kind="quiet" />
      </div>
      {view.state === 'error' ? (
        <ErrorState
          title="Brand book did not open"
          reason={view.reason}
          action={<ButtonLink href={brandBookHref} label="Try again" />}
        />
      ) : (
        <>
          {view.rewrite ? (
            <RewriteCard state={view.rewrite} owner={view.owner} />
          ) : null}
          {!view.book ? (
            <>
              {view.rewrite ? null : (
                <EmptyState
                  title="No Brand book yet"
                  action={<ButtonLink href="/setup" label="Open setup" />}
                />
              )}
              <BrandStatusCard brand={view.brand} owner={view.owner} />
            </>
          ) : (
            <Book
              book={view.book}
              view={view}
              assistant={assistant}
              timezone={view.timezone}
              editable={view.owner && !working(view.rewrite)}
            />
          )}
        </>
      )}
    </AppPage>
  )
}

/** A rewrite that is about to run or running (not failed or stuck). */
export const working = (state: RewriteState | null) =>
  state === 'waiting' || state === 'writing'

/**
 * The Brand book's rewrite (after approve or a correction): its real
 * steps, and the page reads itself again until it is done; failed or
 * stuck, the owner's Try again.
 */
export function RewriteCard({
  state,
  owner
}: {
  state: RewriteState
  owner: boolean
}) {
  const title = 'Rewriting the Brand book'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-4)]">
        <Progress
          title={title}
          steps={rewriteSteps(state, owner)}
          retry={
            owner && !working(state) ? (
              <ActionButton action={retryBrandBookRewrite} label="Try again" />
            ) : undefined
          }
        />
        {working(state) ? <KeepFresh /> : null}
      </div>
    </Card>
  )
}

/**
 * Where the owner's brand version stands, and the way to approve it on
 * Brand, where he sees the positioning, voice and rules he approves (this
 * page shows the book, not those fields).
 */
function BrandStatusCard({
  brand,
  owner
}: {
  brand: Extract<BrandBookPageView, { state: 'ready' }>['brand']
  owner: boolean
}) {
  const title = 'Your brand'
  const approved = brand !== null && brand.approvedRevision === brand.revision
  return (
    <Card label={title}>
      <div className="flex flex-col items-start gap-[var(--space-5)]">
        <div className="flex w-full flex-wrap items-center justify-between gap-[var(--space-3)]">
          <h2 className="type-heading">{title}</h2>
          {brand && !approved && owner ? <Status kind="needs_you" /> : null}
        </div>
        <p className="type-body">
          {!brand
            ? 'No brand yet. Save the brand identity on Brand first.'
            : approved
              ? `Approved for AI use · version ${brand.revision}`
              : owner
                ? `Version ${brand.revision} waits for your approval. Approve it on Brand, where you see what you approve.`
                : `Version ${brand.revision} waits for the owner’s approval.`}
        </p>
        <ButtonLink
          href={brandVersionHref}
          label={
            owner && brand && !approved ? 'Review and approve' : 'Open brand'
          }
          kind={owner && brand && !approved ? 'main' : 'outline'}
        />
      </div>
    </Card>
  )
}

function Book({
  book,
  view,
  assistant,
  timezone,
  editable
}: {
  book: BrandBookView
  view: Extract<BrandBookPageView, { state: 'ready' }>
  assistant: string
  timezone: string
  /** The owner's correction buttons (not while the book is rewritten). */
  editable: boolean
}) {
  return (
    <>
      <CardRow>
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
        <BrandStatusCard brand={view.brand} owner={view.owner} />
      </CardRow>
      {/* Confirmed first, in the order the agents obey them. */}
      <CardRow columns={3}>
        <Section title="Confirmed facts">
          <p className="type-caption text-[var(--stone)]">
            True on every source {assistant} read, or set by you. {assistant}{' '}
            never writes against them.
          </p>
          {book.facts.length ? (
            <ul
              aria-label="Confirmed facts"
              className="flex flex-col gap-[var(--space-2)]"
            >
              {book.facts.map((fact) => (
                <li key={fact.text} className="flex flex-col">
                  <p className="type-body break-words">{fact.text}</p>
                  {fact.own ? <OwnMark /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-body text-[var(--stone)]">
              No fact is confirmed yet, so {assistant} claims none.
            </p>
          )}
          {editable ? (
            <FactsForm texts={book.factTexts} version={book.version} />
          ) : null}
        </Section>
        <Section title="Your words">
          {book.owner === null ? (
            <p className="type-body text-[var(--stone)]">
              Not in this version. Approve your brand, and {assistant} rewrites
              the book with your words right away.
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
      <DesignCard book={book} assistant={assistant} editable={editable} />
      {book.corrections.length ? (
        <Section title="Your corrections">
          <p className="type-caption text-[var(--stone)]">
            Your own word. It comes before what {assistant} saw and before the
            strategist’s reading.
          </p>
          <CorrectionsList
            corrections={book.corrections}
            version={book.version}
            editable={editable}
            assistant={assistant}
          />
        </Section>
      ) : null}
      <CardRow>
        <Section title={`What ${assistant} saw`}>
          <p className="type-caption text-[var(--stone)]">
            Seen on your pages, emails and reviews. Used for tone and ideas,
            never stated as a fact.
            {editable ? ' Correct any line, or add your own.' : ''}
          </p>
          {book.seen.length || book.sending ? (
            <>
              <SeenGroups
                groups={book.seen}
                version={book.version}
                editable={editable}
              />
              {book.sending ? (
                <Group
                  group={{ label: 'How you send today', lines: [book.sending] }}
                />
              ) : null}
            </>
          ) : (
            <p className="type-body text-[var(--stone)]">Nothing seen yet.</p>
          )}
          {book.unclear.length ? (
            <Group
              group={{ label: 'Not clear', lines: book.unclear }}
              note={`Your sources disagree on these, so ${assistant} makes no claim about them.`}
            />
          ) : null}
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
      <Section title="Strategist’s reading">
        <p className="type-caption text-[var(--stone)]">
          A reading of this book, not a fact. It never comes before the facts,
          your words, your corrections or what to avoid.
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
    </>
  )
}

/**
 * PICK-006: the brand's design tokens, by group, each with where it came
 * from; Correct design for the owner. A book written before tokens says
 * the next rewrite adds them.
 */
function DesignCard({
  book,
  assistant,
  editable
}: {
  book: BrandBookView
  assistant: string
  editable: boolean
}) {
  return (
    <Section title="Design">
      <p className="type-caption text-[var(--stone)]">
        Spacing, type sizes, corners and buttons {assistant} uses in every email
        section, kept inside what inboxes show well.
        {editable ? ' Correct any value.' : ''}
      </p>
      {book.design ? (
        <div className="grid gap-[var(--space-5)] sm:grid-cols-2 xl:grid-cols-4">
          {book.design.map((group) => (
            <div
              key={group.label}
              className="flex flex-col gap-[var(--space-3)]"
            >
              <p className="type-body-strong">{group.label}</p>
              <dl
                aria-label={group.label}
                className="flex flex-col gap-[var(--space-3)]"
              >
                {group.lines.map((line) => (
                  <div
                    key={line.key}
                    className="flex flex-col gap-[var(--space-1)]"
                  >
                    <dt className="type-label text-[var(--stone)]">
                      {line.label}
                    </dt>
                    <dd className="type-body break-words">{line.value}</dd>
                    <dd
                      className={
                        line.source === 'owner'
                          ? 'type-caption text-[var(--forest)]'
                          : 'type-caption text-[var(--stone)]'
                      }
                    >
                      {sourceText(line.source, assistant)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <p className="type-body text-[var(--stone)]">
          Not in this version yet. The next rewrite adds them.
        </p>
      )}
      {editable && book.design ? (
        <DesignForm
          texts={book.designTexts}
          own={book.designOwn}
          version={book.version}
        />
      ) : null}
    </Section>
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
