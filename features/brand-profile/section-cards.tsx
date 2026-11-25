'use client'

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import { useFormStatus } from 'react-dom'
import { buttonClasses } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { useHydrated } from '@/components/ui/use-hydrated'
import { cn } from '@/lib/utils'
import { redoBrandSection, saveBrandSection } from './actions'
import { fieldText, sections, type FieldSpec, type Term } from './sections'
import type { SectionView } from './view'

/**
 * The Brand profile's six sections (UI-BRAND) on the GROS components: one
 * card each, read as label and value, with the owner's Edit (inline form)
 * and Redo with AI (the sample writer fills empty fields only). The same
 * server actions and checks as before: `saveBrandSection` with the
 * section's revision (and the brand's on Identity and Tone, whose brand
 * facts the agents read once the owner approves), `redoBrandSection`
 * with the section's revision. BRAND.md has no multi-line field or
 * checkbox yet: they are plain controls on the GROS tokens, as on
 * Settings.
 */
type Section = (typeof sections)[number]
type Answer = { error?: string; message?: string }

const box =
  'type-body w-full rounded-[var(--radius-md)] border-2 border-transparent bg-[var(--mist)] px-[var(--space-4)] py-[var(--space-3)] text-[var(--ink)] focus:border-[var(--forest)] focus:bg-[var(--white)] focus:outline-none'

const asText = (value: unknown) => (typeof value === 'string' ? value : '')
const asList = (value: unknown) =>
  Array.isArray(value) ? (value as (string | Term)[]) : []
const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

/** A field's saved value: brand facts from the brand, notes from the section. */
function valueOf(field: FieldSpec, view: SectionView) {
  return field.fact ? (view.facts?.[field.fact] ?? '') : view.content[field.key]
}

/** The words of a saved value, one item per line (never invented). */
export function valueLines(field: FieldSpec, value: unknown): string[] {
  if (field.key === 'do' || field.key === 'dont') return lines(asText(value))
  if (field.kind === 'text' || field.kind === 'long') {
    const t = asText(value).trim()
    return t ? [t] : []
  }
  return asList(value).map((item) =>
    typeof item === 'string'
      ? field.key === 'signature_phrases'
        ? `“${item}”`
        : item
      : item.definition
        ? `${item.term} — ${item.definition}`
        : item.term
  )
}

function FieldValue({
  field,
  view,
  locked,
  assistant
}: {
  field: FieldSpec
  view: SectionView
  locked: boolean
  assistant: string
}) {
  const shown = valueLines(field, valueOf(field, view))
  const notes = [
    field.fact ? `${assistant} reads this` : '',
    locked ? 'Kept when redone' : ''
  ].filter(Boolean)
  return (
    <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
      <p className="type-label text-[var(--stone)]">
        {field.label}
        {notes.length ? (
          <span className="type-caption"> · {notes.join(' · ')}</span>
        ) : null}
      </p>
      {shown.length === 0 ? (
        <p className="type-body text-[var(--stone)]">Not set yet</p>
      ) : shown.length === 1 && field.kind !== 'list' ? (
        <p className="type-body break-words whitespace-pre-wrap">{shown[0]}</p>
      ) : (
        <ul className="flex flex-col gap-[var(--space-1)]">
          {shown.map((line, i) => (
            <li key={i} className="type-body break-words">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReadView({
  section,
  view,
  assistant
}: {
  section: Section
  view: SectionView
  assistant: string
}) {
  const locked = new Set(view.locked)
  return (
    <div className="grid gap-[var(--space-5)] sm:grid-cols-2">
      {section.fields.map((field) => (
        <div
          key={field.key}
          className={field.kind === 'text' ? undefined : 'sm:col-span-2'}
        >
          <FieldValue
            field={field}
            view={view}
            locked={locked.has(field.key)}
            assistant={assistant}
          />
        </div>
      ))}
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

/** A form button that keeps its words and waits for the page's JavaScript. */
function Submit({
  label,
  spoken,
  kind = 'main'
}: {
  label: string
  spoken?: string
  kind?: 'main' | 'quiet'
}) {
  const { pending } = useFormStatus()
  const hydrated = useHydrated()
  return (
    <button
      type="submit"
      disabled={pending || !hydrated}
      aria-label={spoken}
      className={buttonClasses(kind, kind === 'quiet' ? 'row' : 'app')}
    >
      {label}
    </button>
  )
}

function EditView({
  section,
  view,
  assistant,
  onSaved,
  onCancel
}: {
  section: Section
  view: SectionView
  assistant: string
  onSaved: (message: string) => void
  onCancel: () => void
}) {
  const [state, dispatch, pending] = useActionState<Answer, FormData>(
    saveBrandSection,
    {}
  )
  useEffect(() => {
    if (state.message) onSaved(state.message)
  }, [state, onSaved])
  const errorId = useId()
  const locked = new Set(view.locked)
  const hasFacts = section.fields.some((f) => f.fact)
  return (
    <form
      action={dispatch}
      aria-busy={pending}
      aria-describedby={state.error ? errorId : undefined}
      className="flex flex-col gap-[var(--space-5)]"
      // Keep what the owner typed if the save is refused.
      onReset={(event) => event.preventDefault()}
    >
      <input type="hidden" name="section" value={section.key} />
      <input type="hidden" name="revision" value={view.revision} />
      {hasFacts ? (
        <input type="hidden" name="brand_revision" value={view.brandRevision} />
      ) : null}
      <div className="grid gap-[var(--space-5)] sm:grid-cols-2">
        {section.fields.map((field, index) => {
          const id = `${section.key}-${field.key}`
          const value = fieldText(field, valueOf(field, view))
          const helpText = help(field)
          return (
            <div
              key={field.key}
              className={cn(
                'flex min-w-0 flex-col gap-[var(--space-2)]',
                field.kind !== 'text' && 'sm:col-span-2'
              )}
            >
              {field.kind === 'text' ? (
                <Field
                  id={id}
                  label={field.label}
                  name={field.key}
                  defaultValue={value}
                  maxLength={field.max}
                  autoFocus={index === 0}
                />
              ) : (
                <>
                  <label
                    htmlFor={id}
                    className="gros-field-label text-[var(--ink)]"
                  >
                    {field.label}
                  </label>
                  <textarea
                    id={id}
                    name={field.key}
                    autoFocus={index === 0}
                    className={box}
                    rows={field.kind === 'long' && !field.fact ? 3 : 4}
                    maxLength={field.kind === 'long' ? field.max : undefined}
                    defaultValue={value}
                    aria-describedby={helpText ? `${id}-help` : undefined}
                  />
                </>
              )}
              {helpText ? (
                <p
                  id={`${id}-help`}
                  className="type-caption text-[var(--stone)]"
                >
                  {helpText}
                </p>
              ) : null}
              {field.fact ? (
                <p className="type-caption text-[var(--stone)]">
                  {assistant} reads this once you approve the brand. Only you
                  change it.
                </p>
              ) : (
                <label className="type-caption flex min-h-[var(--control-sm)] items-center gap-[var(--space-2)] text-[var(--stone)]">
                  <input
                    type="checkbox"
                    name="lock"
                    value={field.key}
                    defaultChecked={locked.has(field.key)}
                    className="size-5 accent-[var(--forest)]"
                  />
                  Keep my wording (AI won’t change {field.label.toLowerCase()})
                </label>
              )}
            </div>
          )
        })}
      </div>
      {hasFacts ? (
        <p className="type-body rounded-[var(--radius-md)] bg-[var(--mist)] px-[var(--space-4)] py-[var(--space-3)]">
          Changing a field {assistant} reads means you approve the brand again,
          and campaigns not sent yet go back to draft so their copy can be
          checked.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <Submit label={`Save ${section.title.toLowerCase()}`} />
        <button
          type="button"
          onClick={onCancel}
          className={buttonClasses('quiet')}
        >
          Cancel
        </button>
      </div>
      <p
        id={errorId}
        aria-live="polite"
        className="type-caption text-[var(--signal-ink)] empty:hidden"
      >
        {pending ? '' : (state.error ?? '')}
      </p>
    </form>
  )
}

function SectionCard({
  section,
  view,
  owner,
  assistant,
  products
}: {
  section: Section
  view: SectionView
  owner: boolean
  assistant: string
  products: { title: string }[]
}) {
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [redo, dispatchRedo, redoing] = useActionState<Answer, FormData>(
    redoBrandSection,
    {}
  )
  const returnFocus = useRef(false)
  // Stable, so EditView's effect runs once per save result.
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
  const message = redoing ? null : (notice ?? redo.error ?? redo.message)
  const isError = !notice && Boolean(redo.error)
  return (
    <div id={section.key} className="scroll-mt-[var(--space-6)]">
      <Card label={section.title}>
        <div className="flex flex-col gap-[var(--space-5)]">
          <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
            <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <h2 className="type-heading">{section.title}</h2>
              <p className="type-caption text-[var(--stone)]">
                {[
                  view.updated
                    ? `Updated ${view.updated}`
                    : 'Not filled in yet',
                  view.sample
                    ? 'Has sample text (not real AI): replace it with your own words'
                    : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="type-caption text-[var(--stone)]">
                {section.aiNote}
              </p>
            </div>
            {owner && !editing ? (
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <button
                  id={`edit-${section.key}`}
                  type="button"
                  aria-label={`Edit ${section.title}`}
                  onClick={() => {
                    setNotice(null)
                    setEditing(true)
                  }}
                  className={buttonClasses('quiet')}
                >
                  Edit
                </button>
                <form action={dispatchRedo} onSubmit={() => setNotice(null)}>
                  <input type="hidden" name="section" value={section.key} />
                  <input type="hidden" name="revision" value={view.revision} />
                  <Submit
                    label="Redo with AI"
                    spoken={`Redo with AI: ${section.title}`}
                    kind="quiet"
                  />
                </form>
              </div>
            ) : null}
          </div>
          <p
            aria-live="polite"
            className={cn(
              'type-body empty:hidden',
              isError ? 'text-[var(--signal-ink)]' : 'text-[var(--ink)]'
            )}
          >
            {editing ? '' : (message ?? '')}
          </p>
          {section.key === 'products' ? (
            <ProductTitles products={products} />
          ) : null}
          {editing ? (
            <EditView
              section={section}
              view={view}
              assistant={assistant}
              onSaved={close}
              onCancel={() => close(null)}
            />
          ) : (
            <ReadView section={section} view={view} assistant={assistant} />
          )}
        </div>
      </Card>
    </div>
  )
}

/** The catalog's titles on the Products section, or how to add them. */
function ProductTitles({ products }: { products: { title: string }[] }) {
  if (!products.length)
    return (
      <div className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] bg-[var(--mist)] px-[var(--space-4)] py-[var(--space-3)]">
        <p className="type-body-strong">No products yet</p>
        <p className="type-body">
          Reading products from Klaviyo is not ready yet. For now,{' '}
          <a href="#catalog" className="font-semibold underline">
            add products to the catalog
          </a>{' '}
          below.
        </p>
      </div>
    )
  return (
    <ul
      aria-label="Products in your catalog"
      className="flex flex-wrap gap-[var(--space-2)]"
    >
      {products.slice(0, 12).map((p, i) => (
        <li
          key={i}
          className="type-caption rounded-[var(--radius-md)] bg-[var(--mist)] px-[var(--space-3)] py-[var(--space-2)]"
        >
          {p.title}
        </li>
      ))}
      {products.length > 12 ? (
        <li className="type-caption px-[var(--space-3)] py-[var(--space-2)] text-[var(--stone)]">
          and {products.length - 12} more
        </li>
      ) : null}
    </ul>
  )
}

/** The six sections in the profile's order. */
export function ProfileSections({
  views,
  owner,
  products,
  assistant
}: {
  views: SectionView[]
  owner: boolean
  products: { title: string }[]
  assistant: string
}) {
  const byKey = new Map(views.map((v) => [v.section, v]))
  return (
    <>
      {sections.map((section) => {
        const view = byKey.get(section.key)
        return view ? (
          <SectionCard
            key={section.key}
            section={section}
            view={view}
            owner={owner}
            assistant={assistant}
            products={products}
          />
        ) : null
      })}
    </>
  )
}
