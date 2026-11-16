import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * ListRow (BRAND.md): one email (or code, segment or rule) as a thumbnail,
 * a title, one line of details and one action on the right: a button, or a
 * status pill when there is nothing to do. Only the row that is next has a
 * fill (lime-soft, with the forest button); only one row in a list is
 * next. No divider lines: rows sit 10 px apart. On a narrow screen the
 * action drops under the words instead of squeezing the title.
 */
export function ListRow({
  thumbnail,
  title,
  details,
  next = false,
  end
}: {
  thumbnail: ReactNode
  title: string
  /** Joined with a middle dot: Fri 20 · Past buyers. */
  details: readonly string[]
  next?: boolean
  /** The one action (a row-size Button or ButtonLink) or a Status. */
  end: ReactNode
}) {
  return (
    <li
      className={cn(
        'gros-row flex flex-wrap items-center rounded-[var(--radius-md)]',
        next && 'bg-[var(--lime-soft)]'
      )}
    >
      {thumbnail}
      <div className="gros-row-words flex min-w-0 flex-1 flex-col gap-[var(--space-1)]">
        <p className="type-body-strong truncate">{title}</p>
        <p
          className={cn(
            'type-caption truncate',
            next ? 'text-[var(--ink-soft)]' : 'text-[var(--stone)]'
          )}
        >
          {details.filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="shrink-0">{end}</div>
    </li>
  )
}

/** The list the rows sit in. */
export function RowList({
  label,
  children
}: {
  label?: string
  children: ReactNode
}) {
  return (
    <ul aria-label={label} className="gros-rows flex flex-col">
      {children}
    </ul>
  )
}

/**
 * A designed email's thumbnail: a tiny picture of it in the store's
 * colors (the only place a store's colors appear). 44 by 56 px.
 */
export function EmailThumb({ src, alt = '' }: { src: string; alt?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a stored preview, sized by CSS
    <img
      src={src}
      alt={alt}
      className="gros-thumb shrink-0 rounded-[var(--radius-sm)] bg-[var(--white)] object-cover object-top"
    />
  )
}

/** A text email's thumbnail: three grey lines on mist. */
export function TextThumb() {
  return (
    <span
      aria-hidden
      className="gros-thumb flex shrink-0 flex-col justify-center gap-[var(--space-1)] rounded-[var(--radius-sm)] bg-[var(--mist)] px-[var(--space-2)]"
    >
      {['gros-text-line', 'gros-text-line', 'gros-text-line-short'].map(
        (line, i) => (
          <span
            key={i}
            className={cn(
              line,
              'rounded-[var(--radius-pill)] bg-[var(--stone)]'
            )}
          />
        )
      )}
    </span>
  )
}
