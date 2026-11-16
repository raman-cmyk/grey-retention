import { TicketPercent } from 'lucide-react'
import { ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card, Tile } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { ListRow, RowList } from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import { Status } from '@/components/gros/status'
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
import { saveBrandTimezone, switchToKlaviyoTimezone } from './timezone-actions'

/**
 * Settings (UI-SETa) on the GROS components: the max discount, the codes,
 * Klaviyo, the timezone, the team and the account, one card each. The
 * buttons call the existing server actions, which check the role again:
 * owners and admins change offers; only the owner changes Klaviyo and the
 * timezone. A Klaviyo key is never shown back: only its masked hint.
 */
export function SettingsScreen({ view }: { view: SettingsView }) {
  return (
    <AppPage current="settings" title="Settings">
      <CardRow>
        <MaxDiscountCard view={view} />
        <KlaviyoCard view={view} />
      </CardRow>
      <CardRow>
        <CodesCard view={view} />
        <TimezoneCard view={view} />
      </CardRow>
      <CardRow>
        <TeamCard view={view} />
        <AccountCard view={view} />
      </CardRow>
    </AppPage>
  )
}

const unreadWords: Record<SettingsPart, string> = {
  offers: 'Your offers',
  klaviyo: 'The Klaviyo connection',
  timezone: 'The timezone',
  team: 'The team',
  account: 'Your account'
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

function Title({ text }: { text: string }) {
  return <h2 className="type-heading">{text}</h2>
}

function MaxDiscountCard({ view }: { view: SettingsView }) {
  const label = 'Max discount'
  const offers = view.offers
  return (
    <Card label={label}>
      <div className="flex flex-col gap-[var(--space-5)]">
        {offers ? (
          <>
            <div className="flex flex-col gap-[var(--space-1)]">
              <p className="type-label text-[var(--stone)]">{label}</p>
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
                label="Save max discount"
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
          <>
            <Title text={label} />
            <Unread view={view} part="offers" />
          </>
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
      ? 'Above your max, not used'
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
                details={codeDetails(code, offers.maxDiscountPercent, timezone)}
                end={
                  view.editor ? (
                    <ActionButton
                      action={retireDiscountCode}
                      label="Retire"
                      kind="quiet"
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

function KlaviyoCard({ view }: { view: SettingsView }) {
  const title = 'Klaviyo'
  const k = view.klaviyo
  if (!k)
    return (
      <Card label={title}>
        <div className="flex flex-col gap-[var(--space-5)]">
          <Title text={title} />
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
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
          <Title text={title} />
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
          </div>
        ) : (
          <p className="type-body text-[var(--stone)]">Not connected.</p>
        )}
        {view.owner ? (
          <ActionButton
            action={connectKlaviyo}
            label={
              working ? 'Change key' : problem ? 'Reconnect' : 'Connect Klaviyo'
            }
            kind={working ? 'outline' : 'main'}
          >
            <Field
              label={working ? 'New private API key' : 'Private API key'}
              name="apiKey"
              {...secret}
            />
            <p className="type-caption text-[var(--stone)]">
              {view.liveKeys
                ? 'We check the key with Klaviyo, then keep it encrypted.'
                : 'Sample mode: we check the format only and keep a masked hint, never the key.'}
            </p>
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
            confirm="Disconnect Klaviyo? GROS stops reading it and the key is deleted here. Drafts already in Klaviyo stay there."
          />
        ) : null}
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
  const sample = view.klaviyo?.mode !== 'live' ? ' (sample connection)' : ''
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
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
                  {view.owner
                    ? ' Use it, so times here match Klaviyo.'
                    : ' The workspace owner can switch to it.'}
                </p>
                {view.owner ? (
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
            {view.owner ? (
              <ActionButton
                action={saveBrandTimezone}
                label="Save timezone"
                kind={zone.klaviyo ? 'outline' : 'main'}
                fields={{ expected: zone.saved }}
                keep
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
      </div>
    </Card>
  )
}

function TeamCard({ view }: { view: SettingsView }) {
  const title = 'Team'
  const team = view.team
  return (
    <Card size="small" label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <Title text={title} />
        {!team ? (
          <Unread view={view} part="team" />
        ) : (
          <div className="grid grid-cols-2 gap-[var(--space-3)]">
            <Tile label="Members" value={team.members} />
            {team.openInvites !== null ? (
              <Tile label="Open invites" value={team.openInvites} />
            ) : null}
          </div>
        )}
        <ButtonLink
          href="/team"
          label={team?.canManage ? 'Manage team' : 'See team'}
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
            <p className="type-caption text-[var(--stone)]">{account.email}</p>
          </div>
        )}
        <ButtonLink href="/profile" label="Change" kind="quiet" size="row" />
      </div>
    </Card>
  )
}
