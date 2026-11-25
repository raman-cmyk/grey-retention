'use client'

import { useCallback, useId, useState } from 'react'
import {
  ActionAnswers,
  ActionButton,
  type ActionResult,
  type ServerAction
} from '@/components/gros/action'
import { Button, buttonClasses } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import {
  correctBrandBookFacts,
  correctBrandBookLine,
  withdrawBrandBookCorrection
} from './book-actions'
import { factHelp, factKeys, factLabels, type FactKey } from './book-facts'
import type { CorrectionLine, OwnLine, SeenGroup } from './book-view'

/**
 * The owner's corrections typed into the Brand book (UI-BRAND-2): Correct
 * on a line of what GROS saw (change it, or remove it), Add a line to a
 * part, Correct facts, and Take back on one of his corrections. Each sends
 * the Brand book version on the page (a newer one is refused); the server
 * checks the owner again. `editable` is false for staff and while the book
 * is being rewritten. The answers show in the card's one place.
 */

/** A server action that closes its editor when it succeeds. */
function useCloseOnSuccess(action: ServerAction, close: () => void) {
  return useCallback(
    async (state: ActionResult, form: FormData) => {
      const result = await action(state, form)
      if (!result.error) close()
      return result
    },
    [action, close]
  )
}

/** "Your correction" under a line in the owner's own words. */
export function OwnMark() {
  return <p className="type-caption text-[var(--forest)]">Your correction</p>
}

/** A quiet button with a spoken label that names its line. */
function QuietToggle({
  label,
  spoken,
  onClick
}: {
  label: string
  spoken: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${spoken}`}
      className={buttonClasses('quiet')}
    >
      {label}
    </button>
  )
}

/** Which one editor of the card is open (one main button at a time). */
type Editing = {
  open: boolean
  start: () => void
  close: () => void
}

function LineItem({
  line,
  section,
  version,
  editable,
  editing
}: {
  line: OwnLine
  section: string
  version: number
  editable: boolean
  editing: Editing
}) {
  const { open, start, close } = editing
  const save = useCloseOnSuccess(correctBrandBookLine, close)
  const fields = { version: String(version), section, original: line.text }
  if (open && editable)
    return (
      <li className="flex flex-col gap-[var(--space-3)]">
        <ActionButton
          action={save}
          label="Save line"
          fields={{ ...fields, action: 'replace' }}
          spokenLabel={line.text}
        >
          <Field
            label="Correct this line"
            name="value"
            defaultValue={line.text}
            maxLength={300}
            required
            autoFocus
          />
        </ActionButton>
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <ActionButton
            action={save}
            label="Remove line"
            kind="outline"
            fields={{ ...fields, action: 'remove' }}
            spokenLabel={line.text}
            confirm="Remove this line from your Brand book?"
          />
          <Button kind="quiet" label="Cancel" onClick={close} />
        </div>
      </li>
    )
  return (
    <li className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)]">
        <p className="type-body break-words">{line.text}</p>
        {line.own ? <OwnMark /> : null}
      </div>
      {editable ? (
        <QuietToggle label="Correct" spoken={line.text} onClick={start} />
      ) : null}
    </li>
  )
}

function AddLine({
  group,
  version,
  editing
}: {
  group: SeenGroup
  version: number
  editing: Editing
}) {
  const { open, start, close } = editing
  const add = useCloseOnSuccess(correctBrandBookLine, close)
  if (!open)
    return (
      <div>
        <QuietToggle label="Add a line" spoken={group.label} onClick={start} />
      </div>
    )
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <ActionButton
        action={add}
        label="Add line"
        fields={{
          version: String(version),
          section: group.section,
          action: 'add'
        }}
        spokenLabel={group.label}
      >
        <Field
          label={`New line: ${group.label}`}
          name="value"
          maxLength={300}
          required
          autoFocus
        />
      </ActionButton>
      <div>
        <Button kind="quiet" label="Cancel" onClick={close} />
      </div>
    </div>
  )
}

/**
 * What GROS saw, one tile per part, the owner's lines marked; for the
 * owner, Correct on each line and Add a line on each part.
 */
export function SeenGroups({
  groups,
  version,
  editable
}: {
  groups: SeenGroup[]
  version: number
  editable: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const close = useCallback(() => setEditing(null), [])
  const editor = (key: string): Editing => ({
    open: editing === key,
    start: () => setEditing(key),
    close
  })
  return (
    <ActionAnswers>
      {groups.map((group) => (
        <div
          key={group.section}
          className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--mist)] px-[var(--space-4)] py-[var(--space-4)]"
        >
          <p className="type-label text-[var(--stone)]">{group.label}</p>
          {group.lines.length ? (
            <ul
              aria-label={group.label}
              className="flex flex-col gap-[var(--space-3)]"
            >
              {group.lines.map((line) => (
                <LineItem
                  key={line.text}
                  line={line}
                  section={group.section}
                  version={version}
                  editable={editable}
                  editing={editor(`${group.section}\n${line.text}`)}
                />
              ))}
            </ul>
          ) : (
            <p className="type-body text-[var(--stone)]">Nothing seen yet</p>
          )}
          {editable ? (
            <AddLine
              group={group}
              version={version}
              editing={editor(`add\n${group.section}`)}
            />
          ) : null}
        </div>
      ))}
    </ActionAnswers>
  )
}

/**
 * Correct facts: the four facts as the owner writes them. An empty field
 * makes the fact unknown, so no email claims anything about it.
 */
export function FactsForm({
  texts,
  version
}: {
  texts: Record<FactKey, string>
  version: number
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const save = useCloseOnSuccess(correctBrandBookFacts, close)
  const id = useId()
  return (
    <ActionAnswers>
      {open ? (
        <div className="flex flex-col gap-[var(--space-3)]">
          <ActionButton
            action={save}
            label="Save facts"
            fields={{
              version: String(version),
              ...Object.fromEntries(
                factKeys.map((key) => [`was_${key}`, texts[key]])
              )
            }}
          >
            {factKeys.map((key, i) => (
              <div key={key} className="flex flex-col gap-[var(--space-1)]">
                <Field
                  label={factLabels[key]}
                  name={key}
                  defaultValue={texts[key]}
                  maxLength={40}
                  autoComplete="off"
                  aria-describedby={`${id}-${key}`}
                  autoFocus={i === 0}
                />
                <p
                  id={`${id}-${key}`}
                  className="type-caption text-[var(--stone)]"
                >
                  {factHelp[key]}. Leave it empty if you do not know.
                </p>
              </div>
            ))}
          </ActionButton>
          <div>
            <Button kind="quiet" label="Cancel" onClick={close} />
          </div>
        </div>
      ) : (
        <div>
          <Button
            kind="outline"
            label="Correct facts"
            onClick={() => setOpen(true)}
          />
        </div>
      )}
    </ActionAnswers>
  )
}

/** The owner's live corrections, each with Take back for the owner. */
export function CorrectionsList({
  corrections,
  version,
  editable,
  assistant
}: {
  corrections: CorrectionLine[]
  version: number
  editable: boolean
  assistant: string
}) {
  return (
    <ActionAnswers>
      <ul
        aria-label="Your corrections"
        className="flex flex-col gap-[var(--space-3)]"
      >
        {corrections.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--mist)] px-[var(--space-4)] py-[var(--space-3)]"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)]">
              <p className="type-label text-[var(--stone)]">{c.label}</p>
              <p className="type-body break-words">{c.text}</p>
              {c.pending ? (
                <p className="type-caption text-[var(--stone)]">
                  Not in this version yet
                </p>
              ) : null}
            </div>
            {editable ? (
              <ActionButton
                action={withdrawBrandBookCorrection}
                label="Take back"
                kind="quiet"
                size="row"
                fields={{ version: String(version), correction: c.id }}
                spokenLabel={`${c.label}: ${c.text}`}
                confirm={`Take this correction back? The line goes back to what ${assistant} read.`}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </ActionAnswers>
  )
}
