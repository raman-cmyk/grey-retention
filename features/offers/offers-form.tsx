'use client'
import { useId } from 'react'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { formatBrandDate } from '@/lib/brand-time'
import { addDiscountCode, retireDiscountCode, saveMaxDiscount } from './actions'
import type { ManagedCode } from './source'

const labelClass =
  'tracking-label block font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'
const cardClass =
  'space-y-5 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6'

/**
 * Offers (DSC-001): the max discount and the real codes the agents may use.
 * Owners and admins change them; staff see them.
 */
export function OffersCard({
  maxDiscountPercent,
  revision,
  codes,
  timezone,
  editor
}: {
  maxDiscountPercent: number | null
  revision: number
  codes: ManagedCode[]
  timezone: string
  editor: boolean
}) {
  const id = useId()
  const aboveMax = (c: ManagedCode) =>
    maxDiscountPercent !== null && c.percent > maxDiscountPercent
  return (
    <section className={cardClass} aria-labelledby={`${id}-title`}>
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="text-base font-medium">
          Offers
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Emails never offer more than your max discount, and only use the codes
          below. The AI never makes up a code.
        </p>
      </div>

      <div className="space-y-2">
        <span className={labelClass} id={`${id}-max`}>
          Max discount
        </span>
        {editor ? (
          <ActionForm action={saveMaxDiscount} className="space-y-2">
            <input type="hidden" name="revision" value={revision} />
            <div className="flex items-center gap-3">
              <TextField
                name="percent"
                inputMode="numeric"
                aria-labelledby={`${id}-max`}
                defaultValue={maxDiscountPercent ?? ''}
                placeholder="e.g. 20"
                className="w-24"
                required
              />
              <span className="text-sm text-[var(--text-muted)]">% off</span>
              <SubmitButton variant="secondary">Save max discount</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm">
            {maxDiscountPercent === null
              ? 'Not set yet, so emails offer no discount.'
              : `${maxDiscountPercent}% off`}
          </p>
        )}
        {editor && maxDiscountPercent === null && (
          <p className="text-sm text-[var(--text-muted)]">
            Not set yet, so emails offer no discount.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <span className={labelClass}>Discount codes</span>
        {codes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No codes yet. Emails will not mention a code.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)] text-sm">
            {codes.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <span className="font-mono">{c.code}</span>
                <span>{c.percent}% off</span>
                <span className="text-[var(--text-muted)]">
                  {c.expiresAt
                    ? `${c.ended ? 'ended' : 'until'} ${formatBrandDate(c.expiresAt, timezone)}`
                    : 'no end date'}
                </span>
                {!c.ended && aboveMax(c) && (
                  <span className="text-[var(--text-muted)]">
                    above your max, not used
                  </span>
                )}
                {editor && (
                  <ActionForm action={retireDiscountCode} className="ml-auto">
                    <input type="hidden" name="id" value={c.id} />
                    <SubmitButton variant="quiet" pendingLabel="Removing…">
                      Remove
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {editor && (
          <ActionForm
            action={addDiscountCode}
            className="flex flex-wrap items-end gap-3 pt-2"
          >
            <label className="space-y-1">
              <span className={labelClass}>Code</span>
              <TextField
                name="code"
                placeholder="WELCOME15"
                autoComplete="off"
                className="w-40 font-mono"
                required
              />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Percent off</span>
              <TextField
                name="percent"
                inputMode="numeric"
                placeholder="15"
                className="w-20"
                required
              />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Ends (optional)</span>
              <TextField name="expires" type="date" className="w-40" />
            </label>
            <SubmitButton variant="secondary" pendingLabel="Adding…">
              Add code
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </section>
  )
}
