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
import { saveCampaignDefaults, type SettingsResult } from './actions'
import { saveBrandTimezone, switchToKlaviyoTimezone } from './timezone-actions'
import type { TimezoneSource } from './timezone'
import { timezoneWithOffset } from '@/lib/brand-time'
import {
  defaultTabs,
  fieldTab,
  localTime,
  type CampaignDefaults,
  type DefaultTab,
  type SettingsField
} from './defaults'

const labelClass =
  'tracking-label block font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'
const cardClass =
  'space-y-5 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6'

const sourceText: Record<TimezoneSource, string> = {
  klaviyo: 'From your Klaviyo account (sample connection).',
  owner: 'Chosen by you.',
  setup: 'Set when the workspace was created.',
  unknown: ''
}

/**
 * The ONE brand timezone (UIR-023) with a live clock (spec §11): where it
 * came from, and for the owner a picker and "Use Klaviyo's timezone".
 */
export function TimezoneCard({
  timezone,
  saved: savedZone = timezone,
  options = [timezone],
  initialNow,
  source = 'unknown',
  klaviyoTimezone = null,
  owner = false
}: {
  /** The brand timezone the page shows (UTC if this server lacks it). */
  timezone: string
  /** The brand timezone exactly as saved, sent back with a change. */
  saved?: string
  /** The timezones to pick from, built on the server. */
  options?: string[]
  initialNow: number
  source?: TimezoneSource
  /**
   * The Klaviyo account's timezone, only when it is another zone than the
   * brand's (the server compares spellings).
   */
  klaviyoTimezone?: string | null
  owner?: boolean
}) {
  const id = useId()
  const [now, setNow] = useState(initialNow)
  useEffect(() => {
    // Tick on each new minute, so the clock is never a minute behind.
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(
        () => {
          setNow(Date.now())
          schedule()
        },
        60_000 - (Date.now() % 60_000) + 50
      )
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
  // Counts answers, so the cursor returns to the picker after each one
  // (the button that was pressed may be gone by then).
  const [answers, setAnswers] = useState(0)
  const [saved, save, saving] = useActionState(
    async (previous: FormResult, form: FormData) => {
      const result = await saveBrandTimezone(previous, form)
      setAnswers((n) => n + 1)
      return result
    },
    {}
  )
  const [switched, switchToKlaviyo, switching] = useActionState(
    async (previous: FormResult, form: FormData) => {
      const result = await switchToKlaviyoTimezone(previous, form)
      setAnswers((n) => n + 1)
      return result
    },
    {}
  )
  useEffect(() => {
    if (answers > 0) document.getElementById(`${id}-zone`)?.focus()
  }, [answers, id])
  // The picker follows the saved timezone when it changes (after a save,
  // a switch or another window), without rebuilding the form, so the
  // cursor stays on it; a refused choice stays picked.
  const [choice, setChoice] = useState(savedZone)
  const [shownZone, setShownZone] = useState(savedZone)
  if (shownZone !== savedZone) {
    setShownZone(savedZone)
    setChoice(savedZone)
  }
  // The latest answer, whichever button was used.
  const [last, setLast] = useState<'save' | 'klaviyo'>('save')
  const at = new Date(now)
  const state = last === 'save' ? saved : switched
  const busy = saving || switching
  const text = busy ? '' : (state.error ?? state.message ?? '')
  // The server leaves Klaviyo's timezone out when it is the same zone.
  const differs = klaviyoTimezone !== null && klaviyoTimezone !== savedZone
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
          GROS plans new campaign send times in your brand’s timezone, and most
          dates and times in the app are shown in it. Campaigns already planned
          still send at the same moment.
        </p>
      </div>
      <dl className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className={labelClass}>Brand timezone</dt>
          <dd className="text-[0.9375rem]">
            {timezoneWithOffset(timezone, at)}
          </dd>
          {sourceText[source] && (
            <dd className="text-sm text-[var(--text-muted)]">
              {sourceText[source]}
            </dd>
          )}
        </div>
        <div className="space-y-1">
          <dt className={labelClass}>Current local time</dt>
          <dd className="text-[0.9375rem]">
            <time dateTime={at.toISOString()}>{localTime(timezone, at)}</time>
          </dd>
        </div>
      </dl>
      {differs && (
        <div className="space-y-2 rounded-[var(--radius-control)] bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning-ink)]">
          <p>
            Your Klaviyo account (sample connection) uses{' '}
            <strong>{timezoneWithOffset(klaviyoTimezone, at)}</strong>.
            {owner
              ? ' Use it, so times here match Klaviyo.'
              : ' The workspace owner can switch to it.'}
          </p>
          {owner && (
            <form action={switchToKlaviyo} onSubmit={() => setLast('klaviyo')}>
              <input
                type="hidden"
                name="klaviyoTimezone"
                value={klaviyoTimezone}
              />
              <input type="hidden" name="expected" value={savedZone} />
              <SubmitButton variant="secondary" pendingLabel="Saving…">
                Use Klaviyo’s timezone
              </SubmitButton>
            </form>
          )}
        </div>
      )}
      {owner && (
        // No reset to the old choice after saving or when saving fails.
        <form
          action={save}
          onSubmit={() => setLast('save')}
          onReset={(event) => event.preventDefault()}
          className="flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="expected" value={savedZone} />
          <div className="min-w-0 space-y-1">
            <label htmlFor={`${id}-zone`} className={labelClass}>
              Change timezone
            </label>
            <select
              id={`${id}-zone`}
              name="timezone"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              aria-invalid={last === 'save' && !busy && !!saved.error}
              aria-describedby={`${id}-status`}
              className={cn(controlClass, 'max-w-full')}
            >
              {options.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton variant="secondary" pendingLabel="Saving…">
            Save timezone
          </SubmitButton>
        </form>
      )}
      <p
        id={`${id}-status`}
        aria-live="polite"
        className={cn(
          'text-sm',
          !text
            ? 'sr-only'
            : state.error
              ? 'rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[var(--danger-ink)]'
              : 'rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-[var(--brand-ink)]'
        )}
      >
        {text}
      </p>
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
  const go = (index: number) => {
    const next = defaultTabs[(index + defaultTabs.length) % defaultTabs.length]!
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
            const keys: Record<string, number> = {
              ArrowRight: index + 1,
              ArrowLeft: index - 1,
              Home: 0,
              End: defaultTabs.length - 1
            }
            if (!(event.key in keys)) return
            event.preventDefault()
            go(keys[event.key]!)
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
  error,
  errorId,
  children
}: {
  id: string
  active: boolean
  intro: string
  /** A save error that belongs to a field on this tab. */
  error: string | null
  errorId: string
  children: ReactNode
}) {
  // Every panel stays in the form, so "Save defaults" saves all tabs.
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={`${id}-tab`}
      hidden={!active}
      tabIndex={0}
      className="space-y-4 pt-5 focus-visible:outline-hidden"
    >
      <p className="text-sm text-[var(--text-muted)]">{intro}</p>
      {children}
      {error && (
        <p
          id={errorId}
          className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger-ink)]"
        >
          {error}
        </p>
      )}
    </div>
  )
}

/** "Campaign defaults" card with five tabs and one Save button (spec §11). */
export function DefaultsForm({
  defaults,
  products,
  productsState = 'ready',
  productsSample = false,
  audiences,
  audienceSource,
  owner
}: {
  defaults: CampaignDefaults
  products: ProductOption[]
  productsState?: 'ready' | 'error'
  productsSample?: boolean
  audiences: AudienceOption[]
  audienceSource: 'sample' | 'not_connected' | 'unavailable'
  owner: boolean
}) {
  const [state, dispatch, pending] = useActionState<SettingsResult, FormData>(
    saveCampaignDefaults,
    {}
  )
  const [tab, setTab] = useState<DefaultTab>('product')
  const [product, setProduct] = useState(defaults.featuredProductId)
  const [sendTo, setSendTo] = useState<string[]>(defaults.sendTo)
  const [dontSendTo, setDontSendTo] = useState<string[]>(defaults.dontSendTo)
  const base = useId()
  const panelId = (key: DefaultTab) => `${base}-${key}`
  const inputId = (field: SettingsField) => `${base}-${field}-input`
  const errorId = `${base}-error`
  // A refused save opens the tab with the field and puts focus on it.
  const [shownResult, setShownResult] = useState(state)
  if (shownResult !== state) {
    setShownResult(state)
    if (state.field) setTab(fieldTab[state.field])
  }
  useEffect(() => {
    const field = state.field
    if (!field) return
    requestAnimationFrame(() => {
      const target =
        document.getElementById(`${base}-${field}-input`) ??
        document.getElementById(`${base}-${fieldTab[field]}`)
      target?.focus()
    })
  }, [state, base])
  const fieldError = (field: SettingsField) =>
    !pending && state.field === field ? (state.error ?? null) : null
  const tabError = (key: DefaultTab) =>
    !pending && state.field && fieldTab[state.field] === key
      ? (state.error ?? null)
      : null
  const invalid = (field: SettingsField) =>
    fieldError(field)
      ? { 'aria-invalid': true as const, 'aria-describedby': errorId }
      : {}
  // Without real lists, saved choices must survive a save of another tab.
  const listsShown = audienceSource === 'sample'
  const audienceState =
    listsShown || (sendTo.length === 0 && dontSendTo.length === 0)
      ? 'ready'
      : 'error'
  const noAudiences = listsShown
    ? 'No lists or segments in the sample data.'
    : 'Connect Klaviyo to choose lists and segments.'
  return (
    <form
      action={dispatch}
      aria-busy={pending}
      // Our own checks run on save and open the right tab; the browser's
      // cannot point at a field on a hidden tab.
      noValidate
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
            New campaigns will start with these. Each draft will show the value
            and let you change it before sending. Drafts you already have keep
            their own values.
          </p>
          <p className="text-xs text-[var(--warning-ink)]">
            Saved now, used soon: the new campaign editor (being built) will be
            the first screen to read these defaults.
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
            error={tabError('product')}
            errorId={errorId}
            intro="The single product new campaigns will feature by default. The AI body writer will see its sales, quantities and recent orders."
          >
            <ProductPicker
              label="Featured product"
              name="featured_product"
              options={products}
              value={product}
              onChange={setProduct}
              state={productsState}
              sample={productsSample}
              noneLabel="No featured product"
              emptyMessage="No products yet. They will come from your Klaviyo catalog, or add them under Brand & Store."
            />
          </Panel>
          <Panel
            id={panelId('sender')}
            active={tab === 'sender'}
            error={tabError('sender')}
            errorId={errorId}
            intro="The “from” name recipients will see. Leave it blank to use your Klaviyo account default."
          >
            <label htmlFor={inputId('sender_name')} className={labelClass}>
              Sender name
            </label>
            <TextField
              id={inputId('sender_name')}
              name="sender_name"
              defaultValue={defaults.senderName}
              maxLength={100}
              autoComplete="off"
              {...invalid('sender_name')}
            />
          </Panel>
          <Panel
            id={panelId('link')}
            active={tab === 'link'}
            error={tabError('link')}
            errorId={errorId}
            intro="The address for the main button and links in the email. Leave it blank to let the AI choose."
          >
            <label htmlFor={inputId('primary_link')} className={labelClass}>
              Primary link
            </label>
            <TextField
              id={inputId('primary_link')}
              name="primary_link"
              type="url"
              inputMode="url"
              placeholder="https://"
              defaultValue={defaults.primaryLink}
              maxLength={2000}
              {...invalid('primary_link')}
            />
          </Panel>
          <Panel
            id={panelId('audience')}
            active={tab === 'audience'}
            error={tabError('audience')}
            errorId={errorId}
            intro="Default “Send to” and “Don’t send to” audiences for new campaigns."
          >
            {!listsShown && audienceState === 'error' && (
              <p className="text-sm">
                Klaviyo is not connected, so lists and segments can’t be shown
                right now. Your saved choices are kept when you save.
              </p>
            )}
            <div className="grid gap-5 md:grid-cols-2">
              <AudiencePicker
                label="Send to"
                name="send_to"
                options={audiences}
                value={sendTo}
                onChange={setSendTo}
                sample={listsShown}
                state={audienceState}
                emptyMessage={noAudiences}
              />
              <AudiencePicker
                label="Don’t send to"
                name="dont_send_to"
                options={audiences}
                value={dontSendTo}
                onChange={setDontSendTo}
                sample={listsShown}
                state={audienceState}
                emptyMessage={noAudiences}
              />
            </div>
          </Panel>
          <Panel
            id={panelId('email')}
            active={tab === 'email'}
            error={tabError('email')}
            errorId={errorId}
            intro="New email campaigns will start with the footer included; you will be able to change it on each draft."
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
              defaultValue={defaults.footerSource}
              className={controlClass}
              aria-describedby={`${base}-footer-help`}
            >
              <option value="auto">Auto — built from my brand settings</option>
            </select>
            <p
              id={`${base}-footer-help`}
              className="text-xs text-[var(--text-muted)]"
            >
              The automatic footer will be built from your brand settings
              (organization, mailing address, unsubscribe link). Your Klaviyo
              templates will be listed here once Klaviyo is connected for real.
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
