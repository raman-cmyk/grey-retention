'use client'
import {
  useActionState,
  useEffect,
  useId,
  useState,
  type ReactNode
} from 'react'
import { Clock } from 'lucide-react'
import {
  AudiencePicker,
  type AudienceOption
} from '@/components/ui/audience-picker'
import {
  ProductPicker,
  type ProductOption
} from '@/components/ui/product-picker'
import { SubmitButton, type FormResult } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { controlClass } from '@/components/ui/control'
import { cn } from '@/lib/utils'
import { saveCampaignDefaults } from './actions'
import {
  defaultTabs,
  localTime,
  timezoneLabel,
  type CampaignDefaults,
  type DefaultTab
} from './defaults'

const labelClass =
  'tracking-label block font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'
const cardClass =
  'space-y-5 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6'

/** Read-only brand timezone with a live clock (spec §11). */
export function TimezoneCard({
  timezone,
  initialNow
}: {
  timezone: string
  initialNow: number
}) {
  const [now, setNow] = useState(initialNow)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])
  const at = new Date(now)
  return (
    <section aria-labelledby="timezone-title" className={cardClass}>
      <div className="space-y-1">
        <h2
          id="timezone-title"
          className="flex items-center gap-2 text-lg font-semibold"
        >
          <Clock className="size-5" aria-hidden="true" />
          Timezone
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Campaign send times are scheduled in your brand’s timezone. It is the
          same timezone the Dashboard uses. It is set for your workspace; it is
          not read from Klaviyo yet.
        </p>
      </div>
      <dl className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className={labelClass}>Brand timezone</dt>
          <dd className="text-[0.9375rem]">{timezoneLabel(timezone, at)}</dd>
        </div>
        <div className="space-y-1">
          <dt className={labelClass}>Current local time</dt>
          <dd className="text-[0.9375rem]">
            <time dateTime={at.toISOString()}>{localTime(timezone, at)}</time>
          </dd>
        </div>
      </dl>
    </section>
  )
}

function Tabs({
  active,
  onChange,
  panelId
}: {
  active: DefaultTab
  onChange: (tab: DefaultTab) => void
  panelId: (tab: DefaultTab) => string
}) {
  const move = (from: number, step: number) => {
    const next =
      defaultTabs[(from + step + defaultTabs.length) % defaultTabs.length]!
    onChange(next.key)
    requestAnimationFrame(() =>
      document.getElementById(`${panelId(next.key)}-tab`)?.focus()
    )
  }
  return (
    <div
      role="tablist"
      aria-label="Campaign defaults"
      className="flex gap-6 overflow-x-auto border-b border-[var(--line)] text-sm"
    >
      {defaultTabs.map((tab, index) => (
        <button
          key={tab.key}
          id={`${panelId(tab.key)}-tab`}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          aria-controls={panelId(tab.key)}
          tabIndex={active === tab.key ? 0 : -1}
          onClick={() => onChange(tab.key)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') move(index, 1)
            if (event.key === 'ArrowLeft') move(index, -1)
          }}
          className={cn(
            '-mb-px shrink-0 border-b-2 py-2.5 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden',
            active === tab.key
              ? 'border-[var(--text)] font-medium text-[var(--text)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function Panel({
  id,
  active,
  intro,
  children
}: {
  id: string
  active: boolean
  intro: string
  children: ReactNode
}) {
  // Every panel stays in the form, so "Save defaults" saves all tabs.
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={`${id}-tab`}
      hidden={!active}
      className="space-y-4 pt-5"
    >
      <p className="text-sm text-[var(--text-muted)]">{intro}</p>
      {children}
    </div>
  )
}

/** "Campaign defaults" card with five tabs and one Save button (spec §11). */
export function DefaultsForm({
  defaults,
  products,
  audiences,
  audienceSource,
  owner
}: {
  defaults: CampaignDefaults
  products: ProductOption[]
  audiences: AudienceOption[]
  audienceSource: 'sample' | 'not_connected' | 'unavailable'
  owner: boolean
}) {
  const [state, dispatch, pending] = useActionState<FormResult, FormData>(
    saveCampaignDefaults,
    {}
  )
  const [tab, setTab] = useState<DefaultTab>('product')
  const [product, setProduct] = useState(defaults.featuredProductId)
  const [sendTo, setSendTo] = useState<string[]>(defaults.sendTo)
  const [dontSendTo, setDontSendTo] = useState<string[]>(defaults.dontSendTo)
  const base = useId()
  const panelId = (key: DefaultTab) => `${base}-${key}`
  const noAudiences =
    audienceSource === 'sample'
      ? 'No lists or segments in the sample data.'
      : 'Connect Klaviyo to choose lists and segments.'
  return (
    <form
      action={dispatch}
      aria-busy={pending}
      // Keep what the owner typed if the save is refused.
      onReset={(event) => event.preventDefault()}
      className="space-y-4"
    >
      <input type="hidden" name="revision" value={defaults.revision} />
      <section aria-labelledby={`${base}-title`} className={cardClass}>
        <div className="space-y-1">
          <h2 id={`${base}-title`} className="text-lg font-semibold">
            Campaign defaults
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            These pre-fill every new campaign. Each draft shows the value and
            lets you change it before sending. Drafts you already have keep
            their own values.
          </p>
          <p className="text-xs text-[var(--warning-ink)]">
            Saved now, used soon: the new campaign editor (being built) is the
            first screen that will read these defaults.
          </p>
          {!owner && (
            <p className="text-sm font-medium">
              Only the workspace owner can change these.
            </p>
          )}
        </div>
        {/* Tabs stay usable for everyone; only the fields are read-only. */}
        <Tabs active={tab} onChange={setTab} panelId={panelId} />
        <fieldset disabled={!owner} className="min-w-0">
          <legend className="sr-only">Campaign defaults</legend>
          <Panel
            id={panelId('product')}
            active={tab === 'product'}
            intro="The single product new campaigns feature by default. The AI body writer sees its sales, quantities and recent orders."
          >
            <ProductPicker
              label="Featured product"
              name="featured_product"
              options={products}
              value={product}
              onChange={setProduct}
              noneLabel="No featured product"
              emptyMessage="No products yet. Connect Shopify or add products under Brand & Store."
            />
          </Panel>
          <Panel
            id={panelId('sender')}
            active={tab === 'sender'}
            intro="The “from” name recipients see. Leave it blank to use your Klaviyo account default."
          >
            <label htmlFor={`${base}-sender-input`} className={labelClass}>
              Sender name
            </label>
            <TextField
              id={`${base}-sender-input`}
              name="sender_name"
              defaultValue={defaults.senderName}
              maxLength={100}
              autoComplete="off"
            />
          </Panel>
          <Panel
            id={panelId('link')}
            active={tab === 'link'}
            intro="The address for the main button and links in the email. Leave it blank to let the AI choose."
          >
            <label htmlFor={`${base}-link-input`} className={labelClass}>
              Primary link
            </label>
            <TextField
              id={`${base}-link-input`}
              name="primary_link"
              type="url"
              inputMode="url"
              placeholder="https://"
              defaultValue={defaults.primaryLink}
              maxLength={2000}
            />
          </Panel>
          <Panel
            id={panelId('audience')}
            active={tab === 'audience'}
            intro="Default “Send to” and “Don’t send to” audiences for new campaigns."
          >
            <div className="grid gap-5 md:grid-cols-2">
              <AudiencePicker
                label="Send to"
                name="send_to"
                options={audiences}
                value={sendTo}
                onChange={setSendTo}
                sample={audienceSource === 'sample'}
                state={audienceSource === 'unavailable' ? 'error' : 'ready'}
                emptyMessage={noAudiences}
              />
              <AudiencePicker
                label="Don’t send to"
                name="dont_send_to"
                options={audiences}
                value={dontSendTo}
                onChange={setDontSendTo}
                sample={audienceSource === 'sample'}
                state={audienceSource === 'unavailable' ? 'error' : 'ready'}
                emptyMessage={noAudiences}
              />
            </div>
          </Panel>
          <Panel
            id={panelId('email')}
            active={tab === 'email'}
            intro="New email campaigns start with the footer checked. You can change it on each draft. The footer is built from your Klaviyo brand settings (organization, mailing address, unsubscribe link) when the campaign goes to Klaviyo."
          >
            <h3 className="text-sm font-semibold">
              Email Settings (default for new campaigns)
            </h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="include_footer"
                defaultChecked={defaults.includeFooter}
              />
              Include footer
              <span className="text-[var(--text-muted)]">
                (logo, unsubscribe link, social icons)
              </span>
            </label>
            <hr className="border-[var(--line)]" />
            <label htmlFor={`${base}-footer`} className={labelClass}>
              Footer source
            </label>
            <select
              id={`${base}-footer`}
              name="footer_source"
              defaultValue="auto"
              className={controlClass}
              aria-describedby={`${base}-footer-help`}
            >
              <option value="auto">Auto — built from my brand settings</option>
            </select>
            <p
              id={`${base}-footer-help`}
              className="text-xs text-[var(--text-muted)]"
            >
              Your Klaviyo templates will be listed here once Klaviyo is
              connected for real. Until then the footer is always built
              automatically.
            </p>
          </Panel>
        </fieldset>
      </section>
      {owner && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p
            aria-live="polite"
            className={cn(
              'text-sm empty:hidden',
              !pending &&
                (state.error || state.message) &&
                'rounded-lg px-3 py-2',
              state.error
                ? 'bg-[var(--danger-soft)] text-[var(--danger-ink)]'
                : 'bg-[var(--brand-soft)] text-[var(--brand-ink)]'
            )}
          >
            {pending ? '' : (state.error ?? state.message ?? '')}
          </p>
          <div className="flex flex-col items-end gap-1">
            <SubmitButton>Save defaults</SubmitButton>
            <p className="text-xs text-[var(--text-muted)]">
              Applies to new campaigns only.
            </p>
          </div>
        </div>
      )}
    </form>
  )
}
