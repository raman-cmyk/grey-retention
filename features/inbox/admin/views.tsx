import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { ListRow, RowList } from '@/components/gros/list-row'
import { Status } from '@/components/gros/status'
import { SelectField } from '@/features/admin/fields'
import {
  industries,
  industryName,
  type Industry
} from '@/features/intelligence/taxonomy'
import { inboxAdminAction } from './actions'
import type { DirectoryBrand, OpsTask } from './data'

const day = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(new Date(iso))
    : '—'

const text = (value: unknown) => (typeof value === 'string' ? value : null)

/** How to sign up for a brand, in words that read in a sentence. */
const signUp = (brand: DirectoryBrand) =>
  brand.address
    ? `on ${brand.domain} with ${brand.address}`
    : `on ${brand.domain} with its +${brand.aliasSlug} address (the inbox address shows here once INBOX_IMAP_USER is set in Vercel)`

/** What a task asks a person to do, in plain words. */
export function taskWords(
  task: OpsTask,
  brands: DirectoryBrand[]
): { title: string; help: string } {
  const brand = brands.find((b) => b.id === text(task.detail.brand))
  const from =
    text(task.detail.fromDomain) ??
    task.email?.fromDomain ??
    'an unknown sender'
  const times = task.occurrences > 1 ? ` (${task.occurrences} emails)` : ''
  switch (task.kind) {
    case 'inbox_unknown_sender':
      return text(task.detail.reason) === 'sender_not_registered'
        ? {
            title: `Email to +${text(task.detail.aliasSlug)} from ${from}, a sender not registered for that brand${times}`,
            help: 'Anyone can guess a +alias address. If this sender really is the brand, assign it below; otherwise dismiss.'
          }
        : {
            title: `Email from an unknown sender: ${from}${times}`,
            help: 'Pick the brand it belongs to. Its emails, and every later one from this sender, go to that brand.'
          }
    case 'inbox_parse_failure':
      return {
        title: `An email could not be read${task.email ? `: “${task.email.subject}”` : ''}`,
        help: 'The raw email is kept. Look at it in Gmail, then mark this done.'
      }
    case 'inbox_too_large':
      return {
        title: `An email was too large to keep (${Math.round(Number(task.detail.bytes ?? 0) / 1048576)} MB)`,
        help: 'Only its size and sender were recorded. Mark this done once you have looked at it in Gmail.'
      }
    case 'inbox_opt_in':
      return {
        title: `Confirm a subscription by hand: ${brand?.name ?? from}`,
        help:
          {
            unknown_brand:
              'This confirmation came from a sender we do not know, so nothing was opened. Open the email in Gmail and click its confirm link yourself.',
            no_link:
              'We could not find the confirm link in this email, so nothing was opened. Open the email in Gmail and click its confirm link yourself.',
            refused:
              'The confirm link went somewhere other than the brand’s own site or a known email service, so it was not opened. Open the email in Gmail and check it yourself.',
            failed:
              'The confirm link was opened but did not answer as expected, so it may not have worked. Open the email in Gmail and click it again to be sure.'
          }[text(task.detail.reason) ?? 'refused'] ??
          'Open the email in Gmail and click its confirm link yourself.'
      }
    case 'inbox_unsubscribed':
      return {
        title: `${brand?.name ?? from} unsubscribed us`,
        help: brand
          ? `Sign up again ${signUp(brand)}, then mark this done. The brand then waits for its first newsletter.`
          : 'Sign up again with the brand’s +alias address, then mark this done.'
      }
    case 'inbox_pending_subscription':
      return {
        title: `No newsletter yet from ${brand?.name ?? text(task.detail.domain) ?? 'a brand'} after a week`,
        help: brand
          ? `Check the sign-up ${signUp(brand)}. This task does not come back once it is done.`
          : 'Check the sign-up with the brand’s +alias address.'
      }
    case 'inbox_auth_failed':
      return {
        title: 'Gmail refused the inbox login',
        help: 'Check INBOX_IMAP_USER and the app password (INBOX_IMAP_APP_PASSWORD) in Vercel. The inbox waits 6 hours before trying again; the next good login closes this.'
      }
    default:
      return {
        title: `A background job stopped after four tries (${text(task.detail.kind) ?? task.kind})`,
        help: `Its last error code was ${text(task.detail.code) ?? 'unknown'}. Tell the developers, then mark this done once it is fixed.`
      }
  }
}

/** A brand's subscription in words, for its row. */
const subscriptionWord = (status: string) => {
  const words = status.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * A brand's subscription as a status: unsubscribed needs a person (its
 * task is in the queue), anything not yet subscribed is waiting, and a
 * working subscription needs no pill (its word is in the details).
 */
function SubscriptionStatus({ status }: { status: string }) {
  if (status === 'unsubscribed') return <Status kind="needs_you" />
  if (status === 'subscribed') return null
  return <Status kind="working" word="Waiting" />
}

/** A task's tile: what it asks, since when, and its actions. */
function TaskTile({
  task,
  brands
}: {
  task: OpsTask
  brands: DirectoryBrand[]
}) {
  const words = taskWords(task, brands)
  const sender = text(task.detail.fromDomain) ?? task.email?.fromDomain
  // Sample senders (.example) go to sample brands only, real senders to
  // real brands (the database checks it too).
  const choices = sender
    ? brands.filter((b) => b.sample === sender.endsWith('.example'))
    : []
  return (
    <li className="gros-tile flex flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--mist)]">
      <div className="flex flex-col gap-[var(--space-1)]">
        <h3 className="type-body-strong break-words">{words.title}</h3>
        <p className="type-body break-words">{words.help}</p>
        <p className="type-caption text-[var(--stone)]">
          Since {day(task.createdAt)}
        </p>
      </div>
      {task.kind === 'inbox_unknown_sender' && sender && choices.length > 0 ? (
        <ActionButton
          action={inboxAdminAction}
          label="Assign to this brand"
          kind="outline"
          size="row"
          fields={{ kind: 'assign_sender', sender }}
        >
          <SelectField
            label={`Brand for ${sender}`}
            name="brand"
            required
            defaultValue=""
            onTile
            options={[
              { value: '', label: 'Choose a brand', disabled: true },
              ...choices.map((b) => ({
                value: b.id,
                label: `${b.name} (${b.domain})`
              }))
            ]}
          />
        </ActionButton>
      ) : null}
      <div className="flex flex-wrap items-end gap-[var(--space-3)]">
        <ActionButton
          action={inboxAdminAction}
          label="Mark done"
          kind="outline"
          size="row"
          fields={{ kind: 'resolve_task', task: task.id, outcome: 'resolved' }}
        >
          <Field
            label="Note (optional)"
            name="note"
            maxLength={500}
            placeholder="What you did"
            autoComplete="off"
            onPage
          />
        </ActionButton>
        <ActionButton
          action={inboxAdminAction}
          label="Dismiss"
          kind="quiet"
          size="row"
          fields={{
            kind: 'resolve_task',
            task: task.id,
            outcome: 'dismissed'
          }}
        />
      </div>
    </li>
  )
}

/**
 * What the inbox could not handle on its own (INB-004), as GROS tiles in
 * one card (UI-ADM). The answer of a button shows in the card's one line,
 * so it stays when its task leaves the list.
 */
export function OpsQueue({
  tasks,
  brands
}: {
  tasks: OpsTask[]
  brands: DirectoryBrand[]
}) {
  const title = `Needs a person (${tasks.length})`
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <h2 className="type-heading">{title}</h2>
          {tasks.length === 0 ? (
            <p className="type-body text-[var(--stone)]">
              Nothing to do. The inbox is handling everything.
            </p>
          ) : (
            <ul
              aria-label="Inbox tasks"
              className="flex flex-col gap-[var(--space-3)]"
            >
              {tasks.map((task) => (
                <TaskTile key={task.id} task={task} brands={brands} />
              ))}
            </ul>
          )}
        </ActionAnswers>
      </div>
    </Card>
  )
}

/** A niche from the fixed list (GROS-INS-002), or null for free words. */
const chosenNiche = (niche: string | null): Industry | null => {
  const value = (niche ?? '').trim().toLowerCase()
  return (industries as readonly string[]).includes(value)
    ? (value as Industry)
    : null
}

/** A brand's niche in words: Supplements, or "Niche not set". */
const nicheWords = (niche: string | null) => {
  const chosen = chosenNiche(niche)
  return chosen
    ? `Niche ${industryName(chosen)}`
    : niche && niche !== 'unclassified'
      ? `Niche ${niche} (not on the list)`
      : 'Niche not set'
}

/**
 * GROS-INS-002: a brand's niche, chosen from the fixed industry list. It
 * decides which stores see the brand's Exemplary emails under "Your niche"
 * (it outranks what its emails' labels say). Saved with the brand's own
 * website, +alias and name, so nothing else about the brand changes.
 */
export function NichePicker({ brand }: { brand: DirectoryBrand }) {
  return (
    <ActionButton
      action={inboxAdminAction}
      label="Save niche"
      kind="outline"
      size="row"
      spokenLabel={`Save niche: ${brand.name}`}
      fields={{
        kind: 'save_brand',
        domain: brand.domain,
        alias: brand.aliasSlug,
        name: brand.name
      }}
    >
      <SelectField
        label="Niche"
        name="niche"
        required
        defaultValue={chosenNiche(brand.niche) ?? ''}
        options={[
          { value: '', label: 'Choose a niche', disabled: true },
          ...industries.map((i) => ({ value: i, label: industryName(i) }))
        ]}
      />
    </ActionButton>
  )
}

/**
 * The competitor brands, one row each: where to subscribe, its niche,
 * subscription, last email, how many emails and its sender domains.
 */
export function BrandDirectory({ brands }: { brands: DirectoryBrand[] }) {
  const title = `Brand directory (${brands.length})`
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {brands.length === 0 ? (
          <p className="type-body text-[var(--stone)]">
            No brands yet. Add the first one below.
          </p>
        ) : (
          <RowList label="Competitor brands">
            {brands.map((b) => (
              <ListRow
                key={b.id}
                thumbnail={null}
                title={b.name}
                wrap
                details={[
                  b.domain,
                  b.sample ? 'Sample' : '',
                  b.address
                    ? `Subscribe with ${b.address}`
                    : 'Set INBOX_IMAP_USER in Vercel to see its address',
                  nicheWords(b.niche),
                  subscriptionWord(b.subscription),
                  `Last email ${day(b.lastEmailAt)}`,
                  `${b.emails} ${b.emails === 1 ? 'email' : 'emails'}`,
                  b.senders.length
                    ? `Senders ${b.senders.join(', ')}`
                    : 'No sender domains'
                ]}
                end={
                  <div className="flex flex-wrap items-end gap-[var(--space-3)]">
                    <NichePicker brand={b} />
                    <SubscriptionStatus status={b.subscription} />
                  </div>
                }
              />
            ))}
          </RowList>
        )}
      </div>
    </Card>
  )
}

/**
 * Add a competitor brand: subscribe to its newsletter with its own
 * +alias address and its emails then arrive by themselves.
 */
export function AddBrand() {
  const title = 'Add a brand'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        <ActionButton
          action={inboxAdminAction}
          label="Save brand"
          fields={{ kind: 'save_brand' }}
        >
          <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-2">
            <Field
              label="Brand name"
              name="name"
              required
              maxLength={120}
              placeholder="Northwind Outdoor"
              autoComplete="off"
            />
            <Field
              label="Website domain"
              name="domain"
              required
              maxLength={253}
              placeholder="northwind.com"
              autoComplete="off"
            />
            <Field
              label="+alias (the brand's short name)"
              name="alias"
              required
              pattern="[a-z0-9][a-z0-9\-]{1,39}"
              placeholder="northwind"
              autoComplete="off"
            />
            <Field
              label="Niche"
              name="niche"
              required
              maxLength={60}
              placeholder="apparel"
              autoComplete="off"
            />
            <Field
              label="Sender domains (optional, comma separated)"
              name="senders"
              maxLength={2000}
              placeholder="mail.northwind.com"
              autoComplete="off"
            />
          </div>
        </ActionButton>
      </div>
    </Card>
  )
}
