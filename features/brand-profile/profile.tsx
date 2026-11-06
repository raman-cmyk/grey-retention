'use client'
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, Info, Lock, Pencil, RotateCw, X } from 'lucide-react'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { controlClass } from '@/components/ui/control'
import { redoBrandSection, saveBrandSection } from './actions'
import {
  fieldText,
  sections,
  type FieldSpec,
  type SectionContent,
  type SectionKey,
  type Term
} from './sections'

export type SectionView = {
  section: SectionKey
  content: SectionContent
  locked: string[]
  source: 'sample' | 'owner' | 'saved'
  revision: number
  updated: string | null
}

const labelClass =
  'tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'

function Label({ field, locked }: { field: FieldSpec; locked: boolean }) {
  return (
    <p className={`flex items-center gap-1.5 ${labelClass}`}>
      {field.label}
      {locked && (
        <>
          <Lock className="size-3" aria-hidden="true" />
          <span className="sr-only">(kept when AI redoes this section)</span>
        </>
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

/** Read view of one field, in the old app's layout for that field. */
function Value({ field, value }: { field: FieldSpec; value: unknown }) {
  if (field.kind === 'text' || field.kind === 'long') {
    const text = asText(value)
    return text ? (
      <p className="text-[0.9375rem] leading-6 whitespace-pre-wrap">{text}</p>
    ) : (
      <Empty />
    )
  }
  const items = asList(value)
  if (!items.length) return <Empty />
  if (field.kind === 'terms')
    return (
      <ul className="space-y-1.5 text-sm">
        {(items as Term[]).map((t) => (
          <li key={t.term}>
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
  if (['preferred', 'avoid'].includes(field.key))
    return (
      <ul className="flex flex-wrap gap-2">
        {strings.map((item) => (
          <li
            key={item}
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
        {strings.map((item) => (
          <li key={item}>“{item}”</li>
        ))}
      </ul>
    )
  if (['do', 'dont'].includes(field.key))
    return (
      <ul className="space-y-1.5 text-sm">
        {strings.map((item) => (
          <li key={item} className="flex gap-2">
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
  if (
    field.key === 'subject_lines' ||
    field.key === 'opening_lines' ||
    field.key === 'ctas' ||
    field.key === 'sign_offs'
  )
    return (
      <ul className="space-y-1.5 text-sm">
        {strings.map((item) => (
          <li
            key={item}
            className="rounded-[var(--radius-control)] bg-[var(--surface-hover)] px-3 py-2"
          >
            {item}
          </li>
        ))}
      </ul>
    )
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {strings.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

/** Field arrangement per section (old-app layout). */
function ReadView({
  section,
  view
}: {
  section: (typeof sections)[number]
  view: SectionView | undefined
}) {
  const content = view?.content ?? {}
  const locked = new Set(view?.locked ?? [])
  const field = (key: string) => section.fields.find((f) => f.key === key)!
  const cell = (key: string, className = '') => (
    <div key={key} className={`min-w-0 space-y-1.5 ${className}`}>
      <Label field={field(key)} locked={locked.has(key)} />
      <Value field={field(key)} value={content[key]} />
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
              className="rounded-[var(--radius-control)] border border-[var(--line)] p-3"
            >
              <Label field={field(k)} locked={locked.has(k)} />
              <p className="mt-1 text-sm font-medium">
                {asText(content[k]) || '—'}
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
            value={content.primary_persona}
          />
          <p className="text-xs text-[var(--text-muted)]">
            Age range: {asText(content.age_range) || 'not set'}
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

function EditView({
  section,
  view,
  onDone
}: {
  section: (typeof sections)[number]
  view: SectionView | undefined
  onDone: () => void
}) {
  const locked = new Set(view?.locked ?? [])
  return (
    <ActionForm action={saveBrandSection} className="space-y-5" preserveValues>
      <input type="hidden" name="section" value={section.key} />
      <input type="hidden" name="revision" value={view?.revision ?? 0} />
      <div className="grid gap-5 sm:grid-cols-2">
        {section.fields.map((field, index) => {
          const id = `${section.key}-${field.key}`
          const wide = field.kind !== 'text'
          return (
            <div
              key={field.key}
              className={`min-w-0 space-y-2 ${wide ? 'sm:col-span-2' : ''}`}
            >
              <label htmlFor={id} className={`block ${labelClass}`}>
                {field.label}
              </label>
              {field.kind === 'text' ? (
                <TextField
                  id={id}
                  name={field.key}
                  defaultValue={fieldText(field, view?.content[field.key])}
                  maxLength={field.max}
                  autoFocus={index === 0}
                />
              ) : (
                <textarea
                  id={id}
                  name={field.key}
                  autoFocus={index === 0}
                  className={controlClass}
                  rows={field.kind === 'long' ? 3 : 4}
                  defaultValue={fieldText(field, view?.content[field.key])}
                  aria-describedby={
                    field.kind === 'long' ? undefined : `${id}-help`
                  }
                />
              )}
              {field.kind === 'list' && (
                <p
                  id={`${id}-help`}
                  className="text-xs text-[var(--text-muted)]"
                >
                  One per line, up to 15.
                </p>
              )}
              {field.kind === 'terms' && (
                <p
                  id={`${id}-help`}
                  className="text-xs text-[var(--text-muted)]"
                >
                  One per line: term — what it means.
                </p>
              )}
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
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton>Save {section.title}</SubmitButton>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  )
}

function SectionCard({
  section,
  view,
  owner,
  children
}: {
  section: (typeof sections)[number]
  view: SectionView | undefined
  owner: boolean
  children?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const titleId = `brand-${section.key}`
  return (
    <section
      id={section.key}
      aria-labelledby={titleId}
      className="scroll-mt-24 space-y-5 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">
            {section.title}
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            {view?.source === 'saved'
              ? 'From your saved brand details'
              : view?.updated
                ? `Updated ${view.updated}`
                : 'Not filled in yet'}
            {view?.source === 'sample' && ' · sample suggestion, not real AI'}
          </p>
        </div>
        {owner && !editing && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </Button>
            <ActionForm action={redoBrandSection}>
              <input type="hidden" name="section" value={section.key} />
              <input
                type="hidden"
                name="revision"
                value={view?.revision ?? 0}
              />
              <button
                type="submit"
                title="Redo this section with AI"
                aria-label={`Redo ${section.title} with AI`}
                className="grid size-9 place-items-center rounded-full border border-[var(--line)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
              >
                <RotateCw className="size-4" aria-hidden="true" />
              </button>
            </ActionForm>
          </div>
        )}
      </div>
      {children}
      {editing ? (
        <EditView
          section={section}
          view={view}
          onDone={() => setEditing(false)}
        />
      ) : (
        <ReadView section={section} view={view} />
      )}
    </section>
  )
}

/** Product Intelligence: the catalogue, or the fixed old-app warning callout. */
function ProductsBlock({ products }: { products: { title: string }[] }) {
  if (products.length)
    return (
      <ul className="flex flex-wrap gap-2 text-sm">
        {products.slice(0, 12).map((p) => (
          <li
            key={p.title}
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
        <p className="font-semibold">No products extracted</p>
        <p>
          The website scrape didn’t return enough product detail and either
          Shopify isn’t connected, isn’t synced yet, or the catalog is empty.
        </p>
        <p>
          Fixes:{' '}
          <Link href="/connections" className="font-medium underline">
            connect Shopify
          </Link>{' '}
          (we’ll use your synced catalog as the source), or set a{' '}
          <a href="#products" className="font-medium underline">
            Hero Product URL
          </a>{' '}
          below with Edit, then click the refresh icon above.
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
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section.key} className="space-y-6">
          {section.key === 'tone' && (
            <h2 id="voice" className={`scroll-mt-24 pt-4 ${labelClass}`}>
              Copy & Voice
            </h2>
          )}
          <SectionCard
            section={section}
            view={byKey.get(section.key)}
            owner={owner}
          >
            {section.key === 'products' && (
              <ProductsBlock products={products} />
            )}
          </SectionCard>
        </div>
      ))}
    </div>
  )
}
