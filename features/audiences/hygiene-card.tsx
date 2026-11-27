import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { saveListHygiene } from './hygiene-actions'
import { hygieneDayBounds } from './hygiene'
import type { HygieneView } from './hygiene-view'

/**
 * PICK-101: "Left out" on Audiences (BRAND.md: one card, one question, the
 * number biggest, one main button). Everyone sees how many people GROS's
 * emails leave out and why; the owner changes the days or turns it off.
 */
export function HygieneCard({
  view,
  owner
}: {
  view: HygieneView
  owner: boolean
}) {
  const title = 'Left out'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {view.state !== 'ready' ? (
          <p className="type-body text-[var(--stone)]">
            Who is left out could not be read just now. Open Audiences again in
            a minute.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-[var(--space-1)]">
              {view.number !== null ? (
                <p className="type-number-lg">{view.number}</p>
              ) : null}
              <p className="type-body">{view.words}</p>
              {view.source ? (
                <p className="type-caption text-[var(--stone)]">
                  {view.source}
                </p>
              ) : null}
            </div>
            <ul className="flex flex-col gap-[var(--space-1)]">
              {view.lines.map((line) => (
                <li key={line} className="type-caption text-[var(--stone)]">
                  {line}
                </li>
              ))}
            </ul>
            {owner ? (
              <ActionAnswers>
                <ActionButton
                  action={saveListHygiene}
                  label="Save days"
                  fields={{ enabled: 'on', revision: String(view.revision) }}
                >
                  <Field
                    label={`Days with no clicks, site visits or orders, ${hygieneDayBounds.min} to ${hygieneDayBounds.max}`}
                    name="days"
                    inputMode="numeric"
                    autoComplete="off"
                    defaultValue={view.days}
                    required
                  />
                </ActionButton>
                <ActionButton
                  action={saveListHygiene}
                  label={view.enabled ? 'Turn off' : 'Turn on'}
                  kind="outline"
                  fields={{
                    enabled: view.enabled ? 'off' : 'on',
                    days: String(view.days),
                    revision: String(view.revision)
                  }}
                />
              </ActionAnswers>
            ) : (
              <p className="type-caption text-[var(--stone)]">
                The store’s owner changes this.
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
