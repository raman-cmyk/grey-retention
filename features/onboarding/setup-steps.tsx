import { Store, TicketPercent } from 'lucide-react'
import { ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { ListRow, RowList } from '@/components/gros/list-row'
import { formatBrandDate } from '@/lib/brand-time'
import type { SetupView } from './flow'
import { klaviyoWorking } from './flow-model'
import type { SetupRivals } from './rivals'
import {
  addSetupCode,
  connectSetupKlaviyo,
  finishSetup,
  followRival,
  followSuggestion,
  hideRival,
  saveSetupDiscount,
  skipRivals
} from './setup-actions'
import { SetupForm } from './setup-form'
import { Facts, OwnerOnly, setupPath, Title } from './setup-parts'

/**
 * The Klaviyo, Discount and Rivals steps of `/setup` and its finish
 * (UI-ONBd, UI-ONBe), on the actions the Settings cards and the
 * Inspiration page use: the owner's buttons only, a key never shown back
 * (only its masked hint), the offers and followed brands as saved.
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

function Thumb({ icon: Icon }: { icon: typeof Store }) {
  return (
    <span
      aria-hidden
      className="gros-thumb flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
    >
      <Icon size={18} strokeWidth={2} />
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
                thumbnail={<Thumb icon={TicketPercent} />}
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

export function RivalsStep({
  view,
  rivals
}: {
  view: SetupView
  rivals: SetupRivals | null
}) {
  const following = rivals?.following ?? []
  return (
    <>
      <Title text="Your rivals" />
      {!rivals ? (
        <p className="type-body text-[var(--stone)]">
          Your rivals could not be read just now. Open setup again in a minute.
        </p>
      ) : (
        <>
          {following.length ? (
            <RowList label="Brands you follow">
              {following.map((label) => (
                <ListRow
                  key={label}
                  thumbnail={<Thumb icon={Store} />}
                  title={label}
                  details={['Following']}
                  end={null}
                />
              ))}
            </RowList>
          ) : null}
          <section
            aria-labelledby="setup-suggested"
            className="flex w-full flex-col gap-[var(--space-4)]"
          >
            <h2 id="setup-suggested" className="type-heading">
              Brands like yours
            </h2>
            {rivals.suggestions === null ? (
              <p className="type-body text-[var(--stone)]">
                Suggestions could not be read just now.
              </p>
            ) : rivals.suggestions.length === 0 ? (
              <p className="type-body text-[var(--stone)]">
                No brands to suggest yet.
              </p>
            ) : (
              <RowList label="Brands like yours">
                {rivals.suggestions.map((s) => (
                  <ListRow
                    key={s.captureId}
                    thumbnail={<Thumb icon={Store} />}
                    title={s.name}
                    details={[s.domain, s.reason]}
                    end={
                      view.owner ? (
                        <div className="flex flex-wrap gap-[var(--space-2)]">
                          {s.followable ? (
                            <ActionButton
                              action={followSuggestion}
                              label="Follow"
                              kind="outline"
                              size="row"
                              fields={{ domain: s.domain }}
                            />
                          ) : null}
                          <ActionButton
                            action={hideRival}
                            label="Hide"
                            kind="quiet"
                            size="row"
                            fields={{ capture: s.captureId }}
                          />
                        </div>
                      ) : null
                    }
                  />
                ))}
              </RowList>
            )}
          </section>
          {view.owner && rivals.sample ? (
            <SetupForm
              action={followRival}
              label="Follow"
              kind="outline"
              fields={[
                {
                  name: 'domain',
                  label: 'A brand’s website',
                  inputMode: 'url',
                  autoComplete: 'off',
                  spellCheck: false,
                  maxLength: 300,
                  required: true
                }
              ]}
            />
          ) : null}
        </>
      )}
      {!view.owner ? (
        <OwnerOnly />
      ) : following.length ? (
        <ButtonLink href={setupPath()} label="Continue" size="focus" />
      ) : (
        <ActionButton
          action={skipRivals}
          label="Skip for now"
          kind="outline"
          size="focus"
        />
      )}
    </>
  )
}

export function FinishStep({ view }: { view: SetupView }) {
  const max = view.offers?.maxDiscountPercent ?? null
  return (
    <>
      <Title text="Ready to plan" />
      <Facts
        items={[
          ['Store', view.brand?.domain || 'Not saved'],
          ['Klaviyo', view.klaviyo?.accountLabel ?? 'Connected'],
          ['Biggest discount', max === null ? 'Not set' : `${max}%`]
        ]}
      />
      {view.owner ? (
        <ActionButton action={finishSetup} label="Finish setup" size="focus" />
      ) : (
        <OwnerOnly />
      )}
    </>
  )
}
