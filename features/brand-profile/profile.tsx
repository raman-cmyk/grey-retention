'use client'
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import Link from 'next/link'
import { Check, Info, Lock, Pencil, RotateCw, X } from 'lucide-react'
import { SubmitButton, type FormResult } from '@/components/ui/action-form'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { controlClass } from '@/components/ui/control'
import { cn } from '@/lib/utils'
import { redoBrandSection, saveBrandSection } from './actions'
import { fieldText, sections, type FieldSpec, type Term } from './sections'
import type { SectionView } from './view'

export type { SectionView } from './view'
type Section = (typeof sections)[number]

const labelClass =
  'tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'

function Label({ field, locked }: { field: FieldSpec; locked: boolean }) {
  return (
    <p className={`flex flex-wrap items-center gap-1.5 ${labelClass}`}>
      {field.label}
      {locked && (
        <>
          <Lock className="size-3" aria-hidden="true" />
          <span className="sr-only">(kept when AI redoes this section)</span>
        </>
      )}
      {field.fact && (
        <span className="rounded-full bg-[var(--brand-soft)] px-1.5 py-0.5 text-[0.625rem] tracking-normal text-[var(--brand-ink)] normal-case">
          AI reads
        </span>
      )}
    </p>
  )
}

function Empty() {
  return <p className="text-sm text-[var(--text-faint)]">Not set yet</p>
}

const asList = (value: unknown) =>
  Array.isArray(value) ? (value as (string | Term)[]) : []
const asText = (value: unknown) => (typeof value === 'string' ? value : '')
const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

/** A field's saved value: brand facts from the brand, notes from the section. */
function valueOf(field: FieldSpec, view: SectionView) {
  return field.fact ? (view.facts?.[field.fact] ?? '') : view.content[field.key]
}

/** Read view of one field, in the old app's layout for that field. */
function Value({ field, value }: { field: FieldSpec; value: unknown }) {
  if (field.key === 'do' || field.key === 'dont') {
    const rules = lines(asText(value))
    if (!rules.length) return <Empty />
    return (
      <ul className="space-y-1.5 text-sm">
        {rules.map((item, i) => (
          <li key={i} className="flex gap-2">
            {field.key === 'do' ? (
              <Check
                className="text-success mt-0.5 size-4 shrink-0"
                aria-label="Do"
              />
            ) : (
              <X
                className="mt-0.5 size-4 shrink-0 text-[var(--danger-ink)]"
                aria-label="Don’t"
              />
            )}
            {item}
          </li>
        ))}
      </ul>
    )
  }
  if (field.kind === 'text' || field.kind === 'long') {
    const text = asText(value)
    return text ? (
      <p className="text-[0.9375rem] leading-6 break-words whitespace-pre-wrap">
        {text}
      </p>
    ) : (
      <Empty />
    )
  }
  const items = asList(value)
  if (!items.length) return <Empty />
  if (field.kind === 'terms')
    return (
      <ul className="space-y-1.5 text-sm">
        {(items as Term[]).map((t, i) => (
          <li key={i}>
            <strong>{t.term}</strong>
            {t.definition && (
              <span className="text-[var(--text-muted)]">
                {' '}
                — {t.definition}
              </span>
            )}
          </li>
        ))}
      </ul>
    )
  const strings = items as string[]
  if (field.key === 'preferred' || field.key === 'avoid')
    return (
      <ul className="flex flex-wrap gap-2">
        {strings.map((item, i) => (
          <li
            key={i}
            className={`rounded-full px-2.5 py-1 text-xs ${field.key === 'preferred' ? 'bg-success-faint text-success' : 'bg-[var(--danger-soft)] text-[var(--danger-ink)]'}`}
          >
            {item}
          </li>
        ))}
      </ul>
    )
  if (field.key === 'signature_phrases')
    // {{ placeholders }} are shown verbatim.
    return (
      <ul className="space-y-1.5 text-sm italic">
        {strings.map((item, i) => (
          <li key={i}>“{item}”</li>
        ))}
      </ul>
    )
  if (
    field.key === 'subject_lines' ||
    field.key === 'opening_lines' ||
    field.key === 'ctas' ||
    field.key === 'sign_offs'
  )
    return (
      <ul className="space-y-1.5 text-sm">
        {strings.map((item, i) => (
          <li
            key={i}
            className="rounded-[var(--radius-control)] bg-[var(--surface-hover)] px-3 py-2"
          >
            {item}
          </li>
        ))}
      </ul>
    )
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {strings.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

/** Field arrangement per section (old-app layout). */
function ReadView({ section, view }: { section: Section; view: SectionView }) {
  const locked = new Set(view.locked)
  const field = (key: string) => section.fields.find((f) => f.key === key)!
  const cell = (key: string, className = '') => (
    <div key={key} className={`min-w-0 space-y-1.5 ${className}`}>
      <Label field={field(key)} locked={locked.has(key)} />
      <Value field={field(key)} value={valueOf(field(key), view)} />
    </div>
  )
  if (section.key === 'identity')
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        {[
          'brand_name',
          'niche',
          'positioning',
          'geographic_market',
          'website'
        ].map((k) => cell(k))}
        {cell('origin_story', 'sm:col-span-2')}
        {cell('target_audience', 'sm:col-span-2')}
      </div>
    )
  if (section.key === 'tone')
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {['formality', 'energy', 'warmth', 'archetype'].map((k) => (
            <div
              key={k}
              className="min-w-0 rounded-[var(--radius-control)] border border-[var(--line)] p-3"
            >
              <Label field={field(k)} locked={locked.has(k)} />
              <p className="mt-1 text-sm font-medium break-words">
                {asText(view.content[k]) || '—'}
              </p>
            </div>
          ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {['do', 'dont'].map((k) => cell(k))}
        </div>
      </div>
    )
  if (section.key === 'vocabulary')
    return (
      <div className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          {['preferred', 'avoid'].map((k) => cell(k))}
        </div>
        <hr className="border-[var(--line)]" />
        {cell('terms')}
        <hr className="border-[var(--line)]" />
        {cell('signature_phrases')}
      </div>
    )
  if (section.key === 'audience')
    return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label
            field={field('primary_persona')}
            locked={locked.has('primary_persona')}
          />
          <Value
            field={field('primary_persona')}
            value={view.content.primary_persona}
          />
          <p className="text-xs text-[var(--text-muted)]">
            Age range: {asText(view.content.age_range) || 'not set'}
            {locked.has('age_range') && ' (kept)'}
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {['pain_points', 'motivations', 'emotional_notes'].map((k) =>
            cell(k)
          )}
        </div>
      </div>
    )
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {section.fields.map((f) => cell(f.key))}
    </div>
  )
}

function help(field: FieldSpec) {
  if (field.key === 'do' || field.key === 'dont') return 'One rule per line.'
  if (field.kind === 'list') return 'One per line, up to 15.'
  if (field.kind === 'terms')
    return 'One per line: term — what it means (you can type -- for the dash).'
  return null
}

function EditView({
  section,
  view,
  onSaved,
  onCancel
}: {
  section: Section
  view: SectionView
  onSaved: (message: string) => void
  onCancel: () => void
}) {
  const [state, dispatch, pending] = useActionState<FormResult, FormData>(
    saveBrandSection,
    {}
  )
  useEffect(() => {
    if (state.message) onSaved(state.message)
  }, [state, onSaved])
  const locked = new Set(view.locked)
  const hasFacts = section.fields.some((f) => f.fact)
  return (
    <form
      action={dispatch}
      aria-busy={pending}
      className="space-y-5"
      // Keep what the owner typed if the save is refused.
      onReset={(event) => event.preventDefault()}
    >
      <input type="hidden" name="section" value={section.key} />
      <input type="hidden" name="revision" value={view.revision} />
      {hasFacts && (
        <input type="hidden" name="brand_revision" value={view.brandRevision} />
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {section.fields.map((field, index) => {
          const id = `${section.key}-${field.key}`
          const value = fieldText(field, valueOf(field, view))
          const helpText = help(field)
          return (
            <div
              key={field.key}
              className={`min-w-0 space-y-2 ${field.kind !== 'text' ? 'sm:col-span-2' : ''}`}
            >
              <label htmlFor={id} className={`block ${labelClass}`}>
                {field.label}
              </label>
              {field.kind === 'text' ? (
                <TextField
                  id={id}
                  name={field.key}
                  defaultValue={value}
                  maxLength={field.max}
                  autoFocus={index === 0}
                />
              ) : (
                <textarea
                  id={id}
                  name={field.key}
                  autoFocus={index === 0}
                  className={controlClass}
                  rows={field.kind === 'long' && !field.fact ? 3 : 4}
                  maxLength={field.kind === 'long' ? field.max : undefined}
                  defaultValue={value}
                  aria-describedby={helpText ? `${id}-help` : undefined}
                />
              )}
              {helpText && (
                <p
                  id={`${id}-help`}
                  className="text-xs text-[var(--text-muted)]"
                >
                  {helpText}
                </p>
              )}
              {field.fact ? (
                <p className="text-xs text-[var(--text-muted)]">
                  The AI reads this once you approve the brand. Only you change
                  it.
                </p>
              ) : (
                <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    name="lock"
                    value={field.key}
                    defaultChecked={locked.has(field.key)}
                  />
                  <Lock className="size-3" aria-hidden="true" />
                  Keep my wording (AI won’t change {field.label.toLowerCase()})
                </label>
              )}
            </div>
          )
        })}
      </div>
      {hasFacts && (
        <p className="rounded-[var(--radius-control)] bg-[var(--surface-hover)] p-3 text-sm">
          Changing a field the AI reads means you approve the brand again, and
          campaigns not sent yet go back to draft so their copy can be checked.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <SubmitButton>Save {section.title}</SubmitButton>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p
        aria-live="polite"
        className={cn(
          'text-sm empty:hidden',
          !pending &&
            state.error &&
            'rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[var(--danger-ink)]'
        )}
      >
        {pending ? '' : (state.error ?? '')}
      </p>
    </form>
  )
}

function RedoButton({ title, pending }: { title: string; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      title="Redo this section with AI (sample writer: fills empty fields only)"
      aria-label={`Redo ${title} with AI`}
      className="grid size-9 place-items-center rounded-full border border-[var(--line)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none disabled:opacity-60"
    >
      <RotateCw
        className={cn('size-4', pending && 'animate-spin')}
        aria-hidden="true"
      />
    </button>
  )
}

function SectionCard({
  section,
  view,
  owner,
  children
}: {
  section: Section
  view: SectionView
  owner: boolean
  children?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [redo, dispatchRedo, redoing] = useActionState<FormResult, FormData>(
    redoBrandSection,
    {}
  )
  // Stable, so EditView's effect runs once per save result.
  const returnFocus = useRef(false)
  const close = useCallback((message: string | null) => {
    setNotice(message)
    setEditing(false)
    returnFocus.current = true
  }, [])
  // Back to the Edit button once it is on screen again, so keyboard users
  // keep their place after Save or Cancel.
  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    document.getElementById(`edit-${section.key}`)?.focus()
  }, [editing, section.key])
  const titleId = `brand-${section.key}`
  const message = redoing ? null : (notice ?? redo.error ?? redo.message)
  const isError = !notice && Boolean(redo.error)
  return (
    <section
      id={section.key}
      aria-labelledby={titleId}
      className="scroll-mt-24 space-y-5 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id={titleId} className="text-lg font-semibold">
            {section.title}
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            {view.updated ? `Updated ${view.updated}` : 'Not filled in yet'}
            {view.sample &&
              ' · has sample text (not real AI): replace it with your own words'}
          </p>
          <p className="max-w-prose text-xs text-[var(--text-muted)]">
            {section.aiNote}
          </p>
        </div>
        {owner && !editing && (
          <div className="flex items-center gap-2">
            <Button
              id={`edit-${section.key}`}
              aria-label={`Edit ${section.title}`}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setNotice(null)
                setEditing(true)
              }}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </Button>
            <form action={dispatchRedo} onSubmit={() => setNotice(null)}>
              <input type="hidden" name="section" value={section.key} />
              <input type="hidden" name="revision" value={view.revision} />
              <RedoButton title={section.title} pending={redoing} />
            </form>
          </div>
        )}
      </div>
      <p
        aria-live="polite"
        className={cn(
          'text-sm empty:hidden',
          message && !editing && 'rounded-lg px-3 py-2',
          isError
            ? 'bg-[var(--danger-soft)] text-[var(--danger-ink)]'
            : 'bg-[var(--brand-soft)] text-[var(--brand-ink)]'
        )}
      >
        {editing ? '' : (message ?? '')}
      </p>
      {children}
      {editing ? (
        <EditView
          section={section}
          view={view}
          onSaved={close}
          onCancel={() => close(null)}
        />
      ) : (
        <ReadView section={section} view={view} />
      )}
    </section>
  )
}

/** Product Intelligence: the catalogue, or the old-app warning callout. */
function ProductsBlock({ products }: { products: { title: string }[] }) {
  if (products.length)
    return (
      <ul className="flex flex-wrap gap-2 text-sm">
        {products.slice(0, 12).map((p, i) => (
          <li
            key={i}
            className="rounded-[var(--radius-control)] border border-[var(--line)] px-3 py-1.5"
          >
            {p.title}
          </li>
        ))}
        {products.length > 12 && (
          <li className="px-3 py-1.5 text-[var(--text-muted)]">
            and {products.length - 12} more
          </li>
        )}
      </ul>
    )
  return (
    <div className="flex gap-3 rounded-[var(--radius-control)] border border-[var(--warning-ink)] bg-[var(--warning-soft)] p-4 text-sm">
      <Info
        className="mt-0.5 size-4 shrink-0 text-[var(--warning-ink)]"
        aria-hidden="true"
      />
      <div className="space-y-1.5">
        <p className="font-semibold">No products yet</p>
        <p>Your catalogue is empty.</p>
        <p>
          Fixes: products will come from your Klaviyo catalog once the live{' '}
          <Link href="/connections" className="font-medium underline">
            Klaviyo connection
          </Link>{' '}
          is ready, or{' '}
          <a href="#catalogue" className="font-medium underline">
            add products to the catalogue
          </a>{' '}
          further down this page.
        </p>
      </div>
    </div>
  )
}

/** The six editable sections; Brand Truth first, then Copy & Voice. */
export function BrandProfile({
  views,
  owner,
  products
}: {
  views: SectionView[]
  owner: boolean
  products: { title: string }[]
}) {
  const byKey = new Map(views.map((v) => [v.section, v]))
  const group = (key: 'truth' | 'voice', title: string) => (
    <section aria-labelledby={key} className="space-y-6">
      <h2 id={key} className={`scroll-mt-24 pt-4 ${labelClass}`}>
        {title}
      </h2>
      {sections
        .filter((s) => s.group === key)
        .map((section) => (
          <SectionCard
            key={section.key}
            section={section}
            view={byKey.get(section.key)!}
            owner={owner}
          >
            {section.key === 'products' && (
              <ProductsBlock products={products} />
            )}
          </SectionCard>
        ))}
    </section>
  )
  return (
    <div className="space-y-6">
      {group('truth', 'Brand Truth')}
      {group('voice', 'Copy & Voice')}
    </div>
  )
}
