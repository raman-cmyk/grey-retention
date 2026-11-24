import { TicketPercent } from 'lucide-react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { Button, ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { ListRow, RowList } from '@/components/gros/list-row'
import { AppPage, CardRow, defaultAssistant } from '@/components/gros/nav'
import { Status } from '@/components/gros/status'
import { signOut } from '@/features/auth/presentation/actions'
import {
  connectKlaviyo,
  disconnectKlaviyo
} from '@/features/connections/actions'
import {
  addDiscountCode,
  retireDiscountCode,
  saveMaxDiscount
} from '@/features/offers/actions'
import type { ManagedCode } from '@/features/offers/source'
import { formatBrandDate } from '@/lib/brand-time'
import type { SettingsPart, SettingsView } from './page-model'
import { ChangesCard } from './changes-card'
import { RequestsCard } from './requests-card'
import { SupportCard } from './support-card'
import { TeamCard } from './team-card'
import { saveBrandTimezone, switchToKlaviyoTimezone } from './timezone-actions'

/**
 * Settings (UI-SETa) on the GROS components: the biggest discount, codes,
 * Klaviyo, the timezone, the team and the account, one card each. The
 * buttons call the existing server actions, which check the role again:
 * owners and admins change offers; only the owner changes Klaviyo and the
 * timezone; the owner and managers change the team (UI-SETb). A Klaviyo
 * key is never shown back: only its masked hint. A card's answers show in
 * one place (`ActionAnswers`), so an answer stays when its button goes
 * with the change it made (Remove, Disconnect, Cancel invite).
 */
export function SettingsScreen({
  view,
  assistant = defaultAssistant
}: {
  view: SettingsView
  /** The assistant's name (the white label may rename it). */
  assistant?: string
}) {
  return (
    <AppPage current="settings" title="Settings" assistant={assistant}>
      <CardRow>
        <MaxDiscountCard view={view} />
        <KlaviyoCard view={view} assistant={assistant} />
      </CardRow>
      <CardRow>
        <CodesCard view={view} />
        <TimezoneCard view={view} />
      </CardRow>
      <CardRow>
        <TeamCard view={view} unread={<Unread view={view} part="team" />} />
        <AccountCard view={view} />
      </CardRow>
      <CardRow>
        <HolidaysCard assistant={assistant} />
      </CardRow>
      <SupportCard view={view} unread={<Unread view={view} part="support" />} />
      <RequestsCard
        view={view}
        unread={<Unread view={view} part="requests" />}
      />
      {/* Who changed what: the owner and managers only (UI-SETc). */}
      {view.editor ? (
        <ChangesCard
          view={view}
          unread={<Unread view={view} part="changes" />}
        />
      ) : null}
    </AppPage>
  )
}

const unreadWords: Record<SettingsPart, string> = {
  offers: 'Your offers',
  klaviyo: 'The Klaviyo connection',
  timezone: 'The timezone',
  team: 'The team',
  account: 'Your account',
  changes: 'Recent changes',
  support: 'Your support questions',
  requests: 'Your feature requests'
}

/** Why a card has nothing to show. */
function Unread({ view, part }: { view: SettingsView; part: SettingsPart }) {
  return (
    <p className="type-body text-[var(--stone)]">
      {view.demo
        ? 'Nothing is kept in the demo.'
        : `${unreadWords[part]} could not be read just now. Open Settings again in a minute.`}
    </p>
  )
}

/** A card's title; `id` is the anchor other pages open (`/settings#klaviyo`). */
function Title({ text, id }: { text: string; id?: string }) {
  return (
    <h2 id={id} className="type-heading">
      {text}
    </h2>
  )
}

function MaxDiscountCard({ view }: { view: SettingsView }) {
  const title = 'Biggest discount'
  const offers = view.offers
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <Title text={title} />
        {offers ? (
          <>
            <div className="flex flex-col gap-[var(--space-1)]">
              <p className="type-number-lg">
                {offers.maxDiscountPercent === null
                  ? 'Not set'
                  : `${offers.maxDiscountPercent}%`}
              </p>
              <p className="type-caption text-[var(--stone)]">
                {offers.maxDiscountPercent === null ||
                offers.maxDiscountPercent === 0
                  ? 'Emails offer no discount.'
                  : 'No email offers more than this.'}
              </p>
            </div>
            {view.editor ? (
              <ActionButton
                action={saveMaxDiscount}
                label="Save biggest discount"
                fields={{ revision: String(offers.revision) }}
              >
                <Field
                  label="Percent off, 0 to 100"
                  name="percent"
                  inputMode="numeric"
                  autoComplete="off"
                  defaultValue={offers.maxDiscountPercent ?? ''}
                  required
                />
              </ActionButton>
            ) : null}
          </>
        ) : (
          <Unread view={view} part="offers" />
        )}
      </div>
    </Card>
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

function codeDetails(
  code: ManagedCode,
  max: number | null,
  timezone: string
): string[] {
  const date = code.expiresAt ? formatBrandDate(code.expiresAt, timezone) : null
  return [
    `${code.percent}% off`,
    date ? `${code.ended ? 'Ended' : 'Until'} ${date}` : 'No end date',
    !code.ended && max !== null && code.percent > max
      ? 'Above your biggest discount, not used'
      : ''
  ]
}

function CodesCard({ view }: { view: SettingsView }) {
  const title = 'Discount codes'
  const offers = view.offers
  const timezone = view.timezone?.saved ?? 'UTC'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <Title text={title} />
          {!offers ? (
            <Unread view={view} part="offers" />
          ) : offers.codes.length === 0 ? (
            <p className="type-body text-[var(--stone)]">
              No codes yet. Emails will not mention a code.
            </p>
          ) : (
            <RowList label={title}>
              {offers.codes.map((code) => (
                <ListRow
                  key={code.id}
                  thumbnail={<CodeThumb />}
                  title={code.code}
                  details={codeDetails(
                    code,
                    offers.maxDiscountPercent,
                    timezone
                  )}
                  end={
                    view.editor ? (
                      <ActionButton
                        action={retireDiscountCode}
                        label="Remove"
                        spokenLabel={code.code}
                        kind="outline"
                        size="row"
                        fields={{ id: code.id }}
                      />
                    ) : null
                  }
                />
              ))}
            </RowList>
          )}
          {offers && view.editor ? (
            <ActionButton action={addDiscountCode} label="Add code">
              <div className="grid gap-[var(--space-4)] sm:grid-cols-3">
                <Field
                  label="Code"
                  name="code"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={40}
                  required
                />
                <Field
                  label="Percent off"
                  name="percent"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                />
                <Field label="Ends (optional)" name="expires" type="date" />
              </div>
            </ActionButton>
          ) : null}
        </ActionAnswers>
      </div>
    </Card>
  )
}

/** The key field: a password box the browser and password managers leave alone. */
const secret = {
  type: 'password',
  autoComplete: 'off',
  spellCheck: false,
  required: true,
  'data-1p-ignore': true,
  'data-lpignore': 'true'
} as const

/** Audiences' Connect Klaviyo and Reconnect open this card (UI-AUDc). */
const klaviyoAnchor = 'klaviyo'

function KlaviyoCard({
  view,
  assistant
}: {
  view: SettingsView
  assistant: string
}) {
  const title = 'Klaviyo'
  const k = view.klaviyo
  if (!k)
    return (
      <Card label={title}>
        <div className="flex flex-col gap-[var(--space-5)]">
          <Title text={title} id={klaviyoAnchor} />
          <Unread view={view} part="klaviyo" />
        </div>
      </Card>
    )
  const linked = k.status === 'connected'
  // With live keys on, a sample connection still waits for a real key.
  const working =
    linked && k.keyStatus !== 'refused' && !(view.liveKeys && k.mode !== 'live')
  const problem =
    k.keyStatus === 'refused'
      ? 'Klaviyo key stopped working. Reconnect with a new key.'
      : k.status === 'expired'
        ? 'This connection has expired. Paste a new key to reconnect.'
        : k.status === 'error'
          ? 'This connection stopped working. Paste a new key to reconnect.'
          : linked && !working
            ? 'Sample connection. Paste your real key to connect your Klaviyo.'
            : null
  const checked = k.checkedAt
    ? formatBrandDate(k.checkedAt, view.timezone?.saved ?? 'UTC')
    : null
  // What the key cannot do yet, for steps that come later.
  const later = [
    k.missingLater.includes('flows:read') ? 'read your flows' : '',
    k.missingLater.some((s) => s !== 'flows:read') ? 'send emails' : ''
  ].filter(Boolean)
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
            <Title text={title} id={klaviyoAnchor} />
            {/* A working connection needs no pill (In Klaviyo is a draft's
              word); Needs you only when the owner must act. */}
            {!working && view.owner ? <Status kind="needs_you" /> : null}
          </div>
          {linked || problem ? (
            <div className="flex flex-col gap-[var(--space-1)]">
              {linked ? (
                <p className="type-body-strong">
                  {k.accountLabel ?? 'Sample account'}
                </p>
              ) : null}
              <p className="type-caption text-[var(--stone)]">
                {[
                  k.keyHint ? `Key ${k.keyHint}` : '',
                  k.mode === 'sample'
                    ? 'Sample data. Nothing is sent to Klaviyo.'
                    : checked
                      ? `Checked ${checked}`
                      : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {problem ? (
                <p className="type-body text-[var(--signal-ink)]">{problem}</p>
              ) : null}
              {working && later.length ? (
                <p className="type-caption text-[var(--stone)]">
                  Later, to {later.join(' and ')}, {assistant} needs a key with
                  more access.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="type-body text-[var(--stone)]">Not connected.</p>
          )}
          {view.owner ? (
            <ActionButton
              action={connectKlaviyo}
              label={
                working
                  ? 'Change key'
                  : problem
                    ? 'Reconnect'
                    : 'Connect Klaviyo'
              }
              kind={working ? 'outline' : 'main'}
              clear="always"
            >
              <Field
                label={working ? 'New private API key' : 'Private API key'}
                name="apiKey"
                {...secret}
              />
            </ActionButton>
          ) : (
            <p className="type-body text-[var(--stone)]">
              Only the workspace owner can change Klaviyo.
            </p>
          )}
          {view.owner && k.status !== 'none' && k.status !== 'disconnected' ? (
            <ActionButton
              action={disconnectKlaviyo}
              label="Disconnect"
              kind="quiet"
              confirm={`Disconnect Klaviyo? ${assistant} stops reading it and the key is deleted here. Drafts already in Klaviyo stay there.`}
            />
          ) : null}
        </ActionAnswers>
      </div>
    </Card>
  )
}

const sourceWords = {
  owner: 'Chosen by you.',
  setup: 'Set when the workspace was created.',
  klaviyo: 'From your Klaviyo account.',
  unknown: ''
} as const

function TimezoneCard({ view }: { view: SettingsView }) {
  const title = 'Timezone'
  const zone = view.timezone
  // The sample connection's timezone is the sample's, so say so.
  const sample = view.klaviyo?.mode === 'sample' ? ' (sample connection)' : ''
  // Nothing is kept in the demo, so it offers no change.
  const owner = view.owner && !view.demo
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <Title text={title} />
          {!zone ? (
            <Unread view={view} part="timezone" />
          ) : (
            <>
              <div className="flex flex-col gap-[var(--space-1)]">
                <p className="type-body-strong">{zone.label}</p>
                <p className="type-caption text-[var(--stone)]">
                  {zone.source === 'klaviyo'
                    ? `From your Klaviyo account${sample}.`
                    : sourceWords[zone.source]}
                </p>
                <p className="type-caption text-[var(--stone)]">
                  Now <time dateTime={zone.at}>{zone.localTime}</time>
                </p>
              </div>
              {zone.klaviyo ? (
                <div className="flex flex-col gap-[var(--space-3)]">
                  <p className="type-body">
                    Your Klaviyo account{sample} uses {zone.klaviyo.label}.
                    {owner
                      ? ' Use it, so times here match Klaviyo.'
                      : ' The workspace owner can switch to it.'}
                  </p>
                  {owner ? (
                    <ActionButton
                      action={switchToKlaviyoTimezone}
                      label="Use Klaviyo’s timezone"
                      fields={{
                        klaviyoTimezone: zone.klaviyo.zone,
                        expected: zone.saved
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
              {view.demo ? <Unread view={view} part="timezone" /> : null}
              {owner ? (
                <ActionButton
                  action={saveBrandTimezone}
                  label="Save timezone"
                  kind={zone.klaviyo ? 'outline' : 'main'}
                  fields={{ expected: zone.saved }}
                >
                  <Field
                    label="Change timezone"
                    name="timezone"
                    list="settings-timezones"
                    autoComplete="off"
                    spellCheck={false}
                    defaultValue={zone.saved}
                    required
                  />
                  <datalist id="settings-timezones">
                    {zone.options.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </ActionButton>
              ) : null}
            </>
          )}
        </ActionAnswers>
      </div>
    </Card>
  )
}

/** Holidays and events have their own page under Settings (UI-SETd). */
function HolidaysCard({ assistant }: { assistant: string }) {
  const title = 'Holidays and events'
  return (
    <Card size="small" label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <Title text={title} />
        <p className="type-body text-[var(--stone)]">
          Your own dates, and the holidays {assistant} plans around.
        </p>
        <ButtonLink
          href="/settings/holidays"
          label="Open holidays"
          kind="outline"
        />
      </div>
    </Card>
  )
}

function AccountCard({ view }: { view: SettingsView }) {
  const title = 'Account'
  const account = view.account
  return (
    <Card size="small" label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <Title text={title} />
        {!account ? (
          <Unread view={view} part="account" />
        ) : (
          <div className="flex flex-col gap-[var(--space-1)]">
            <p className="type-body-strong">{account.name || account.email}</p>
            {account.name ? (
              <p className="type-caption text-[var(--stone)]">
                {account.email}
              </p>
            ) : null}
          </div>
        )}
        <div className="flex flex-wrap gap-[var(--space-3)]">
          <ButtonLink
            href="/settings/account"
            label="Change"
            kind="quiet"
            size="row"
          />
          <form action={signOut}>
            <Button type="submit" label="Log out" kind="quiet" size="row" />
          </form>
        </div>
      </div>
    </Card>
  )
}
