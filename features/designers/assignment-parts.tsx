import { PenTool } from 'lucide-react'
import Image from 'next/image'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { relativeTime } from '@/lib/brand-time'
import { cn } from '@/lib/utils'
import { DueText } from './due-text'
import {
  reviewSection,
  reviewWords,
  type AssignmentStatus,
  type DueLine
} from './model'

const label =
  'tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'

/** Title, status, due time and one sentence on what to do next. */
export function BriefHeader({
  title,
  brand,
  copyRevision,
  status,
  due
}: {
  title: string
  brand: string
  copyRevision: number
  status: AssignmentStatus
  due: DueLine | null
}) {
  return (
    <Card>
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--inverse)] text-[var(--on-inverse)]"
        >
          <PenTool className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={label}>Design brief</p>
          <h1 className="tracking-display mt-1 font-serif text-[1.875rem] leading-tight font-normal break-words">
            {title}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
            <Pill tone={status.tone}>{status.label}</Pill>
            <span>
              {brand} · Approved copy v{copyRevision}
            </span>
          </p>
          {due && (
            <p className="mt-1 text-sm">
              <DueText due={due} />
            </p>
          )}
          <p className="mt-3 text-sm leading-6">{status.meaning}</p>
        </div>
      </div>
    </Card>
  )
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="space-y-4 text-sm">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className={cn(label, 'mb-1')}>{k}</dt>
          <dd className="leading-6 break-words whitespace-pre-wrap">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function orNone(value: string | null | undefined, none: string) {
  return value?.trim() ? (
    value
  ) : (
    <span className="text-[var(--text-muted)]">{none}</span>
  )
}

/** The exact copy the owner approved; the design must carry it unchanged. */
export function ApprovedCopy({
  subject,
  preheader,
  body,
  cta,
  url
}: {
  subject: string
  preheader: string
  body: string
  cta: string
  url: string
}) {
  return (
    <Card title="Approved copy">
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Use this text exactly. Changing it needs a new owner approval.
      </p>
      <Facts
        rows={[
          ['Subject', orNone(subject, 'No subject')],
          ['Preview text', orNone(preheader, 'No preview text')],
          ['Body', orNone(body, 'No body')],
          ['Button', orNone(cta, 'No button')],
          ['Link', orNone(url, 'No link')]
        ]}
      />
    </Card>
  )
}

const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Brand facts from the snapshot taken when the brief was assigned. */
export function BrandFacts({
  brandName,
  brandRevision,
  voice,
  prohibitions,
  sequenceBrief,
  referenceStructure,
  kit
}: {
  brandName: string
  brandRevision?: number
  voice: string
  prohibitions: string
  sequenceBrief?: string | null
  referenceStructure: string
  kit?: {
    colors: string[]
    fonts: string[]
    approved: boolean
  } | null
}) {
  return (
    <Card title="Brand">
      <Facts
        rows={[
          [
            'Brand',
            `${brandName}${brandRevision ? ` · profile v${brandRevision}` : ''}`
          ],
          [
            'Brand kit',
            kit ? (
              <span className="block space-y-2">
                <span className="flex flex-wrap gap-2">
                  {kit.colors.map((c, i) => (
                    <span
                      key={`${i}-${c}`}
                      className="inline-flex max-w-full items-center gap-1.5 font-mono text-xs break-all"
                    >
                      {hex.test(c) && (
                        <span
                          aria-hidden
                          className="size-4 rounded border border-[var(--line-strong)]"
                          style={{ backgroundColor: c }}
                        />
                      )}
                      {c}
                    </span>
                  ))}
                </span>
                <span className="block">
                  {kit.fonts.length ? kit.fonts.join(', ') : 'No fonts listed'}{' '}
                  · {kit.approved ? 'owner approved' : 'not yet owner approved'}
                </span>
              </span>
            ) : (
              orNone(null, 'No brand kit in this brief')
            )
          ],
          ['Voice', orNone(voice, 'No voice notes')],
          ["Don't", orNone(prohibitions, 'No prohibitions')],
          [
            'Series',
            orNone(sequenceBrief, 'A single send, not part of a series')
          ],
          [
            'Reference structure',
            orNone(referenceStructure, 'No reference layout picked')
          ]
        ]}
      />
    </Card>
  )
}

/** Private brand images shared with this brief (links expire in 5 minutes). */
export function InspirationPack({
  assets
}: {
  assets: { path: string; preview: string | null }[]
}) {
  const shown = assets.filter((a) => a.preview)
  return (
    <Card title="Inspiration pack">
      {shown.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((a) => (
            <Image
              key={a.path}
              src={a.preview!}
              width={200}
              height={200}
              unoptimized
              alt="Private asset included in this assigned inspiration pack"
              className="h-auto w-full rounded border border-[var(--line)]"
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          {assets.length
            ? 'The shared images could not be loaded. Refresh to try again.'
            : 'No images were shared with this brief.'}
        </p>
      )}
    </Card>
  )
}

export type OwnerReview = {
  id: string
  decision: string
  section: string
  feedback: string
  created_at: string
}

/** What the brand owner said about each version, newest first. */
export function OwnerFeedback({
  reviews,
  now
}: {
  reviews: OwnerReview[]
  now: Date
}) {
  return (
    <Card title="Owner feedback">
      {reviews.length ? (
        <ol className="space-y-4">
          {reviews.map((r) => {
            const words = reviewWords(r.decision)
            return (
              <li key={r.id} className="text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Pill tone={words.tone}>{words.label}</Pill>
                  <span className="font-semibold break-words">
                    {reviewSection(r.section)}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {relativeTime(r.created_at, now) ?? ''}
                  </span>
                </p>
                {r.feedback && (
                  <p className="mt-2 leading-6 break-words whitespace-pre-wrap">
                    {r.feedback}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          No owner feedback yet. It appears here after the owner reviews a
          version.
        </p>
      )}
    </Card>
  )
}

export type Submission = {
  id: string
  revision: number
  copy_revision: number
  notes: string
  created_at: string
  preview: string | null
}

/** Every version this designer submitted, newest first. */
export function SubmissionHistory({
  submissions,
  now
}: {
  submissions: Submission[]
  now: Date
}) {
  return (
    <Card title="Your submissions">
      {submissions.length ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {submissions.map((s) => (
            <article key={s.id} className="min-w-0">
              <h3 className="font-semibold">
                Design v{s.revision} · copy v{s.copy_revision}
              </h3>
              <p className="mb-3 text-xs text-[var(--text-muted)]">
                Submitted {relativeTime(s.created_at, now) ?? ''}
              </p>
              {s.preview ? (
                <Image
                  src={s.preview}
                  alt={`Your submitted design version ${s.revision}`}
                  width={600}
                  height={800}
                  unoptimized
                  className="h-auto max-h-[40rem] w-auto max-w-full rounded-lg border border-[var(--line)]"
                />
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  The image could not be loaded. Refresh to try again.
                </p>
              )}
              {s.notes && (
                <p className="mt-3 text-sm break-words whitespace-pre-wrap">
                  {s.notes}
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          No versions submitted yet.
        </p>
      )}
    </Card>
  )
}
