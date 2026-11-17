import { TicketPercent } from 'lucide-react'
import { ButtonLink } from '@/components/gros/button'
import { ListRow, RowList } from '@/components/gros/list-row'
import { formatBrandDate } from '@/lib/brand-time'
import type { SetupView } from './flow'
import { klaviyoWorking } from './flow-model'
import {
  addSetupCode,
  connectSetupKlaviyo,
  saveSetupDiscount
} from './setup-actions'
import { SetupForm } from './setup-form'
import { Facts, OwnerOnly, setupPath, Title } from './setup-parts'

/**
 * The Klaviyo and Discount steps of `/setup` (UI-ONBd), on the actions the
 * Settings cards use: the owner's buttons only, a key never shown back
 * (only its masked hint), the offers as saved.
 */
export function KlaviyoStep({ view }: { view: SetupView }) {
  const k = view.klaviyo
  const working = klaviyoWorking(k, view.liveKeys)
  const problem =
    k?.keyStatus === 'refused'
      ? 'Klaviyo key stopped working. Reconnect with a new key.'
      : k?.status === 'expired'
        ? 'This connection has expired. Paste a new key to reconnect.'
        : k?.status === 'error'
          ? 'This connection stopped working. Paste a new key to reconnect.'
          : k?.status === 'connected' && !working
            ? 'Sample connection. Paste your real key to connect your Klaviyo.'
            : null
  return (
    <>
      <Title text="Connect Klaviyo" />
      {working && k ? (
        <>
          <Facts
            items={[
              ['Account', k.accountLabel ?? 'Sample account'],
              ['Key', k.keyHint ?? 'Saved']
            ]}
          />
          {k.mode === 'sample' ? (
            <p className="type-caption text-[var(--stone)]">
              Sample data. Nothing is sent to Klaviyo.
            </p>
          ) : null}
        </>
      ) : null}
      {problem ? (
        <p className="type-body text-[var(--signal-ink)]">{problem}</p>
      ) : null}
      {!view.owner ? (
        <OwnerOnly />
      ) : working ? (
        <ButtonLink href={setupPath()} label="Continue" size="focus" />
      ) : (
        <>
          <SetupForm
            action={connectSetupKlaviyo}
            label={problem ? 'Reconnect' : 'Connect Klaviyo'}
            keepOnError={false}
            fields={[
              {
                name: 'apiKey',
                label: 'Private API key',
                type: 'password',
                autoComplete: 'off',
                spellCheck: false,
                required: true
              }
            ]}
          />
          <p className="type-caption text-[var(--stone)]">
            {view.liveKeys
              ? 'We check the key with Klaviyo, then keep it encrypted.'
              : 'Sample mode: we check the key’s format only and keep a masked hint.'}
          </p>
        </>
      )}
    </>
  )
}

function CodeThumb() {
  return (
    <span
      aria-hidden
      className="gros-thumb flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
    >
      <TicketPercent size={18} strokeWidth={2} />
    </span>
  )
}

export function DiscountStep({ view }: { view: SetupView }) {
  const offers = view.offers
  const max = offers?.maxDiscountPercent ?? null
  const codes = offers?.codes.filter((c) => !c.ended) ?? []
  return (
    <>
      <Title text="Your discount" />
      {view.owner && offers ? (
        <SetupForm
          action={saveSetupDiscount}
          label="Save discount"
          hidden={{ revision: String(offers.revision) }}
          fields={[
            {
              name: 'percent',
              label: 'Biggest discount, in percent',
              defaultValue: max ?? '',
              inputMode: 'numeric',
              autoComplete: 'off',
              required: true
            }
          ]}
        />
      ) : (
        <>
          <Facts
            items={[['Biggest discount', max === null ? 'Not set' : `${max}%`]]}
          />
          <OwnerOnly />
        </>
      )}
      <section
        aria-labelledby="setup-codes"
        className="flex w-full flex-col gap-[var(--space-4)]"
      >
        <h2 id="setup-codes" className="type-heading">
          Discount codes
        </h2>
        {codes.length ? (
          <RowList label="Discount codes">
            {codes.map((code) => (
              <ListRow
                key={code.id}
                thumbnail={<CodeThumb />}
                title={code.code}
                details={[
                  `${code.percent}% off`,
                  code.expiresAt
                    ? `Until ${formatBrandDate(code.expiresAt, view.timezone)}`
                    : 'No end date',
                  max !== null && code.percent > max
                    ? 'Above your biggest discount, not used'
                    : ''
                ]}
                end={null}
              />
            ))}
          </RowList>
        ) : (
          <p className="type-body text-[var(--stone)]">
            No codes yet. Emails will not mention a code.
          </p>
        )}
        {view.owner && offers ? (
          <SetupForm
            action={addSetupCode}
            label="Add code"
            kind="outline"
            fields={[
              {
                name: 'code',
                label: 'Code',
                autoComplete: 'off',
                spellCheck: false,
                maxLength: 40,
                required: true
              },
              {
                name: 'percent',
                label: 'Percent off',
                inputMode: 'numeric',
                autoComplete: 'off',
                required: true
              },
              { name: 'expires', label: 'Ends (optional)', type: 'date' }
            ]}
          />
        ) : null}
      </section>
    </>
  )
}
