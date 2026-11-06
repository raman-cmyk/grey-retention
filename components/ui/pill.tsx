import type { ReactNode } from 'react'
import {
  campaignStatuses,
  type CampaignStatus,
  type PillTone
} from '@/lib/campaign-status'
import { cn } from '@/lib/utils'

/**
 * Small uppercase pills (docs/UI_REBUILD_SPEC.md §2 "Status pill, type pill,
 * domain pill"). Colour is never the only signal: the word is always there.
 */
/** Colour classes per tone; also used by calendar chips so colours match. */
export const pillToneClasses: Record<PillTone, string> = {
  neutral:
    'border-[var(--line-strong)] bg-[var(--surface-raised)] text-[var(--text-muted)]',
  success: 'border-transparent bg-success-faint text-success',
  warning:
    'border-transparent bg-[var(--warning-soft)] text-[var(--warning-ink)]',
  danger: 'border-transparent bg-[var(--danger-soft)] text-[var(--danger-ink)]',
  info: 'border-transparent bg-[var(--brand-soft)] text-[var(--brand-ink)]',
  'accent-2': 'border-transparent bg-accent-2-faint text-accent-2',
  // Brand primary + on-brand: a pair the white-label contrast gate checks.
  solid: 'border-transparent bg-[var(--brand-primary)] text-[var(--on-brand)]'
}

export const pillTones = Object.keys(pillToneClasses) as PillTone[]

export function Pill({
  tone = 'neutral',
  title,
  mono = false,
  className,
  children
}: {
  tone?: PillTone
  /** Plain-English meaning, shown on hover. */
  title?: string
  /** Mono letters for codes such as domains and ids. */
  mono?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      data-tone={tone}
      className={cn(
        'tracking-label inline-flex min-h-5 max-w-full items-center rounded-full border px-2 py-0.5 text-[0.6875rem] leading-none font-semibold whitespace-nowrap uppercase forced-colors:border-[CanvasText]',
        mono && 'font-mono',
        pillToneClasses[tone],
        className
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

/** One of the campaign statuses, with its fixed word, colour and meaning. */
export function StatusPill({
  status,
  className
}: {
  status: CampaignStatus
  className?: string
}) {
  const entry = campaignStatuses[status]
  return (
    <Pill tone={entry.tone} title={entry.meaning} className={className}>
      {entry.label}
    </Pill>
  )
}

const types = {
  design: { label: 'Design', tone: 'info', meaning: 'A designed email.' },
  text: {
    label: 'Text',
    tone: 'accent-2',
    meaning: 'A plain text-style email with no design.'
  }
} as const satisfies Record<
  string,
  { label: string; tone: PillTone; meaning: string }
>

export type EmailType = keyof typeof types

/** DESIGN or TEXT email. */
export function TypePill({
  type,
  className
}: {
  type: EmailType
  className?: string
}) {
  const entry = types[type]
  return (
    <Pill tone={entry.tone} title={entry.meaning} className={className}>
      {entry.label}
    </Pill>
  )
}

/**
 * A sender's domain in uppercase mono, for example `NORTHWIND.EXAMPLE`.
 * Anything that is not a plain host name shows as "Unknown domain".
 */
export function DomainPill({
  domain,
  className
}: {
  domain: string
  className?: string
}) {
  const host = domainLabel(domain)
  return (
    <Pill mono className={className} title={host ?? undefined}>
      {host ?? 'Unknown domain'}
    </Pill>
  )
}

export function domainLabel(input: string) {
  const value = input.trim().toLowerCase()
  if (!value || value.length > 2048 || /\s/.test(value)) return null
  let host: string
  try {
    // Accepts full URLs, bare hosts and host:port; puny-codes Unicode names.
    host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//.test(value) ? value : `http://${value}`
    ).hostname
  } catch {
    return null
  }
  if (value.includes('@') && !/^[a-z][a-z0-9+.-]*:\/\//.test(value)) return null
  host = host.replace(/^www\./, '').replace(/\.$/, '')
  return host.length <= 253 &&
    /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(
      host
    )
    ? host
    : null
}
