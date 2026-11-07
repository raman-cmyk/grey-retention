'use client'
import type { Route } from 'next'
import Link from 'next/link'
import { Search, Sparkles } from 'lucide-react'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { DomainPill, Pill, TypePill } from '@/components/ui/pill'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextField } from '@/components/ui/text-field'
import { PlainTextEmail } from '@/features/email-generation/plain-text-email'
import { PreviewCardFrame } from '@/features/email-generation/preview-card-frame'
import { ScaledFrame } from '@/features/email-generation/scaled-frame'
import { formatBrandDate } from '@/lib/brand-time'
import { cn } from '@/lib/utils'
import {
  filterLibrary,
  latestUploads,
  libraryTabs,
  pageSize,
  referenceHref,
  tabCounts,
  tabLabel,
  type LibraryItem,
  type LibraryTab,
  type ShowFilter
} from './model'

const emptyText: Record<LibraryTab, { title: string; body: string }> = {
  competitors: {
    title: 'No competitor emails yet',
    body: 'Track a competitor’s domain on the Inspiration page. Their latest 20 sends show up here.'
  },
  yours: {
    title: 'Nothing here yet',
    body: 'Emails you paste or upload, and layouts saved from your campaigns, show up here to use as a reference.'
  },
  best: {
    title: 'No best picks uploaded yet.',
    body: 'Reach out to your admin — they curate this library.'
  }
}

const emailsWord = (n: number) => `${n} ${n === 1 ? 'email' : 'emails'}`

/** What the card and the preview say about an item without a design. */
/** The label above the text when an item has no design to show. */
const textHeadingOf = (item: LibraryItem) =>
  item.source === 'template' ? 'Saved layout' : 'Plain-text email'

const noDesignText = (item: LibraryItem) =>
  item.source === 'template'
    ? 'This saved layout has no preview yet. Using it starts from the same sections.'
    : 'Plain-text email: there is no design to show.'

function Card({
  item,
  timezone,
  onOpen,
  action,
  selected
}: {
  item: LibraryItem
  timezone: string
  onOpen: () => void
  action: React.ReactNode
  selected: boolean
}) {
  return (
    <li
      className={cn(
        'group flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border bg-[var(--surface-raised)] focus-within:border-[var(--brand-secondary)] hover:border-[var(--brand-secondary)]',
        selected
          ? 'border-[var(--brand-secondary)] ring-2 ring-[var(--brand-secondary)]'
          : 'border-[var(--line)]'
      )}
    >
      {/* The render scrolls inside; it is not a click target (one per card). */}
      <div className="h-72 overflow-hidden border-b border-[var(--line)] bg-white">
        {item.preview ? (
          <ScaledFrame
            title={`Preview of ${item.title}`}
            srcDoc={item.preview.html}
            height={900}
          />
        ) : (
          <div className="h-full overflow-auto p-4 text-xs">
            <PlainTextEmail text={item.text} heading={textHeadingOf(item)} />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col gap-2 p-4 text-left outline-none focus-visible:bg-[var(--surface-hover)]"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          {item.domain && <DomainPill domain={item.domain} />}
          <TypePill type={item.format} />
          {item.sample && <Pill tone="neutral">Sample</Pill>}
          {selected && <Pill tone="info">Selected</Pill>}
          <span className="ml-auto text-xs text-[var(--text-muted)]">
            {formatBrandDate(item.at, timezone)}
          </span>
        </span>
        <span className="line-clamp-2 text-sm font-semibold break-words">
          {item.title}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{item.from}</span>
        <span className="sr-only">Open the preview</span>
      </button>
      {/* Shown on hover or focus where the device can hover; always on touch. */}
      {action && (
        <div className="px-4 pb-4 opacity-100 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0">
          {action}
        </div>
      )}
    </li>
  )
}

/**
 * The ONE reference library (UIR-022): tabs with the same counts wherever it
 * appears, search, Email Design / Email Text, competitor domain chips, a
 * grid of sandboxed previews (links off) and an in-page preview.
 *
 * - `browse` (the Inspiration page): "Use this design" starts a new draft
 *   with the reference chosen.
 * - `pick` (New draft, the editor's design picker): "Use this reference"
 *   calls `onPick`; the caller decides what happens next.
 */
type ModeProps =
  | {
      mode?: 'browse'
      /**
       * Whether "Use this design" is offered (it starts a new draft, which
       * only the owner can do).
       */
      canUse?: boolean
      onPick?: never
      selected?: never
    }
  | {
      mode: 'pick'
      /**
       * Called with the chosen item. Send only `item.id` and `item.source`
       * back to the server, never its preview markup.
       */
      onPick: (item: LibraryItem) => void
      /** The reference already chosen (id and source), marked "Selected". */
      selected?: Pick<LibraryItem, 'id' | 'source'> | null
      canUse?: never
    }

export function ReferenceLibrary(
  props: {
    items: LibraryItem[]
    /** The brand timezone the dates are shown in. */
    timezone: string
    initialTab?: LibraryTab
    /**
     * True when only the latest uploads were read (`latestUploads`); the
     * Yours tab then says so.
     */
    uploadsCapped?: boolean
  } & ModeProps
) {
  const {
    items,
    timezone,
    initialTab = 'competitors',
    uploadsCapped = false
  } = props
  const canUse = props.mode === 'pick' || props.canUse !== false
  const chosen = props.mode === 'pick' ? props.selected : null
  const isSelected = (item: LibraryItem) =>
    chosen?.id === item.id && chosen.source === item.source
  const id = useId()
  const [tab, setTab] = useState<LibraryTab>(initialTab)
  const [show, setShow] = useState<ShowFilter>('all')
  const [search, setSearch] = useState('')
  const [domains, setDomains] = useState<string[]>([])
  const [shown, setShown] = useState(pageSize)
  const [open, setOpen] = useState<LibraryItem | null>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const counts = useMemo(() => tabCounts(items), [items])
  const allDomains = useMemo(
    () =>
      [
        ...new Set(
          items
            .filter((i) => i.tab === 'competitors' && i.domain)
            .map((i) => i.domain!)
        )
      ].sort(),
    [items]
  )
  const matches = useMemo(
    () => filterLibrary(items, { tab, show, search, domains }),
    [items, tab, show, search, domains]
  )
  const filtered = show !== 'all' || search.trim() !== '' || domains.length > 0
  const visible = matches.slice(0, shown)
  const reset = () => {
    setShow('all')
    setSearch('')
    setDomains([])
  }
  const choose = (next: LibraryTab) => {
    setTab(next)
    setShown(pageSize)
    setDomains([])
  }
  const onTabKey = (event: KeyboardEvent, index: number) => {
    const last = libraryTabs.length - 1
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % libraryTabs.length
        : event.key === 'ArrowLeft'
          ? (index + last) % libraryTabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    choose(libraryTabs[next]!)
    tabRefs.current[next]?.focus()
  }
  const action = (item: LibraryItem) =>
    !canUse ? null : props.mode === 'pick' ? (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          setOpen(null)
          props.onPick(item)
        }}
      >
        <Sparkles className="size-4" aria-hidden="true" />
        Use this reference
        <span className="sr-only">
          : {item.title}
          {isSelected(item) ? ' (selected now)' : ''}
        </span>
      </Button>
    ) : (
      <Link
        href={referenceHref(item) as Route}
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-[var(--brand-ink)] underline-offset-2 hover:underline"
      >
        <Sparkles className="size-4" aria-hidden="true" />
        Use this design
        <span className="sr-only">: {item.title}</span>
      </Link>
    )
  return (
    <section aria-label="Reference library" className="space-y-4">
      <div
        role="tablist"
        aria-label="Library"
        className="flex flex-wrap gap-1 border-b border-[var(--line)]"
      >
        {libraryTabs.map((value, index) => (
          <button
            key={value}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${value}`}
            aria-selected={tab === value}
            aria-controls={`${id}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => choose(value)}
            onKeyDown={(event) => onTabKey(event, index)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              tab === value
                ? 'border-[var(--brand-secondary)] text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            {tabLabel[value]}{' '}
            <span className="tabular-nums">{counts[value]}</span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${tab}`}
        className="space-y-4"
      >
        {counts[tab] > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor={`${id}-search`} className="sr-only">
                Search the library
              </label>
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
                aria-hidden="true"
              />
              <TextField
                id={`${id}-search`}
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setShown(pageSize)
                }}
                placeholder="Search subject, sender or text…"
                className="pl-9"
              />
            </div>
            <SegmentedControl
              name={`${id}-show`}
              legend="Show"
              options={[
                { value: 'all', label: 'All' },
                { value: 'design', label: 'Email Design' },
                { value: 'text', label: 'Email Text' }
              ]}
              value={show}
              onValueChange={(value) => {
                setShow(value)
                setShown(pageSize)
              }}
            />
            {/* Always mounted, so the first change is read out too. */}
            <p
              className={cn(
                'text-sm text-[var(--text-muted)]',
                !filtered && 'sr-only'
              )}
              aria-live="polite"
            >
              {filtered ? emailsWord(matches.length) : ''}
            </p>
          </div>
        )}
        {tab === 'competitors' && allDomains.length > 1 && (
          <div
            role="group"
            aria-label="Filter by domain"
            className="flex flex-wrap gap-2"
          >
            {allDomains.map((domain) => {
              const on = domains.includes(domain)
              return (
                <button
                  key={domain}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setDomains((list) =>
                      on ? list.filter((d) => d !== domain) : [...list, domain]
                    )
                    setShown(pageSize)
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 font-mono text-xs uppercase',
                    on
                      ? 'border-[var(--brand-secondary)] bg-[var(--brand-soft)] text-[var(--brand-ink)]'
                      : 'border-[var(--line-strong)] text-[var(--text-muted)]'
                  )}
                >
                  {domain}
                </button>
              )
            })}
          </div>
        )}
        {counts[tab] === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-dashed border-[var(--line-strong)] p-8 text-center">
            <p className="font-semibold">{emptyText[tab].title}</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {emptyText[tab].body}
            </p>
            {tab === 'yours' && canUse && (
              <Link
                href="/import-reference"
                className="mt-3 inline-block text-sm font-medium underline"
              >
                Paste or upload an email
              </Link>
            )}
          </div>
        ) : matches.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No emails match.{' '}
            <button type="button" className="underline" onClick={reset}>
              Show all
            </button>
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
              {visible.map((item) => (
                <Card
                  key={`${item.source}:${item.id}`}
                  item={item}
                  timezone={timezone}
                  onOpen={() => setOpen(item)}
                  action={action(item)}
                  selected={isSelected(item)}
                />
              ))}
            </ul>
            {tab === 'yours' && uploadsCapped && (
              <p className="text-sm text-[var(--text-muted)]">
                Showing your latest {latestUploads} uploads.
              </p>
            )}
            {matches.length > visible.length && (
              <div className="text-center">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShown((n) => n + pageSize)}
                >
                  Load more ({matches.length - visible.length} more)
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <Modal
        open={open !== null}
        title={open?.title ?? 'Preview'}
        subtitle={
          open
            ? `${open.from} · ${formatBrandDate(open.at, timezone) ?? ''}`
            : undefined
        }
        cancelLabel="Close"
        onClose={() => setOpen(null)}
        footer={open ? (action(open) ?? undefined) : undefined}
      >
        {open && (
          <PreviewCardFrame
            title={`Preview of ${open.title}`}
            preview={open.preview}
            text={open.text}
            caption={
              open.preview
                ? 'Links are turned off, and outside fonts, images and tracking pixels don’t load because the preview is isolated from the web.'
                : noDesignText(open)
            }
            notes={[]}
            height={900}
            textHeading={textHeadingOf(open)}
          />
        )}
      </Modal>
    </section>
  )
}
