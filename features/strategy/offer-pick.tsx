'use client'

import { useActionState, useId } from 'react'
import { useFormStatus } from 'react-dom'
import { buttonClasses } from '@/components/gros/button'
import { useHydrated } from '@/components/ui/use-hydrated'
import { pickOffers } from './actions'

/**
 * The owner's offer pick (D20) on the GROS screen: tick offers, or let GROS
 * choose, or run none; the action refuses ticks with another choice and
 * says why under the button.
 */
export function OfferPick({
  runId,
  offers
}: {
  runId: string
  offers: readonly { id: string; label: string }[]
}) {
  const [state, dispatch, pending] = useActionState(pickOffers, {})
  const errorId = useId()
  const error = pending ? null : (state.error ?? null)
  return (
    <form
      action={dispatch}
      // React resets a form after its action: a refused pick keeps the
      // owner's ticks and choice, so the reason under the button is true.
      onReset={(event) => event.preventDefault()}
      aria-busy={pending}
      className="flex flex-col gap-[var(--space-6)]"
    >
      <input type="hidden" name="run" value={runId} />
      {offers.length > 0 && (
        <fieldset className="flex flex-col gap-[var(--space-3)]">
          <legend className="type-body-strong mb-[var(--space-3)]">
            The offers you can run
          </legend>
          {offers.map((o) => (
            <label
              key={o.id}
              className="type-body flex items-center gap-[var(--space-3)]"
            >
              <input type="checkbox" name="offers" value={o.id} />
              {o.label}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-[var(--space-3)]">
        <legend className="type-body-strong mb-[var(--space-3)]">
          How should we use them?
        </legend>
        {offers.length > 0 && (
          <label className="type-body flex items-center gap-[var(--space-3)]">
            <input type="radio" name="mode" value="picked" />
            Only the offers I tick
          </label>
        )}
        <label className="type-body flex items-center gap-[var(--space-3)]">
          <input type="radio" name="mode" value="auto" defaultChecked />
          You choose
        </label>
        <label className="type-body flex items-center gap-[var(--space-3)]">
          <input type="radio" name="mode" value="none" />
          No offers this time
        </label>
      </fieldset>
      <div className="flex flex-col items-start gap-[var(--space-2)]">
        <Submit describedBy={error ? errorId : undefined} />
        <p
          id={errorId}
          aria-live="polite"
          className="type-caption text-[var(--signal-ink)] empty:hidden"
        >
          {error ?? ''}
        </p>
      </div>
    </form>
  )
}

function Submit({ describedBy }: { describedBy?: string }) {
  const { pending } = useFormStatus()
  const hydrated = useHydrated()
  return (
    <button
      type="submit"
      disabled={pending || !hydrated}
      aria-describedby={describedBy}
      className={buttonClasses('main', 'app')}
    >
      Plan the 15 days
    </button>
  )
}
