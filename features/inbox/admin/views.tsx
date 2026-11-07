import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { DataTable } from '@/components/ui/data-table'
import { Pill } from '@/components/ui/pill'
import { TextField } from '@/components/ui/text-field'
import { Field, Panel, controlClass } from '@/components/ui/workspace'
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

const subscriptionTone = (status: string) =>
  status === 'subscribed'
    ? 'success'
    : status === 'unsubscribed'
      ? 'danger'
      : 'warning'

export function OpsQueue({
  tasks,
  brands
}: {
  tasks: OpsTask[]
  brands: DirectoryBrand[]
}) {
  return (
    <Panel
      title={`Needs a person (${tasks.length})`}
      description="What the inbox could not handle on its own."
    >
      {tasks.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          Nothing to do. The inbox is handling everything.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Inbox tasks">
          {tasks.map((task) => {
            const words = taskWords(task, brands)
            const sender =
              text(task.detail.fromDomain) ?? task.email?.fromDomain
            // Sample senders (.example) go to sample brands only, real
            // senders to real brands (the database checks it too).
            const choices = sender
              ? brands.filter((b) => b.sample === sender.endsWith('.example'))
              : []
            return (
              <li
                key={task.id}
                className="space-y-3 rounded-[var(--radius-control)] border border-[var(--line)] p-4"
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">{words.title}</h3>
                  <p className="text-sm text-[var(--text-muted)]">
                    {words.help}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Since {day(task.createdAt)}
                  </p>
                </div>
                {task.kind === 'inbox_unknown_sender' &&
                  sender &&
                  choices.length > 0 && (
                    <ActionForm
                      action={inboxAdminAction}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="kind" value="assign_sender" />
                      <input type="hidden" name="sender" value={sender} />
                      <Field label={`Brand for ${sender}`}>
                        <select
                          name="brand"
                          required
                          className={controlClass}
                          defaultValue=""
                        >
                          <option value="" disabled>
                            Choose a brand
                          </option>
                          {choices.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.domain})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <SubmitButton pendingLabel="Assigning…">
                        Assign to this brand
                      </SubmitButton>
                    </ActionForm>
                  )}
                <div className="flex flex-wrap items-end gap-2">
                  <ActionForm
                    action={inboxAdminAction}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="kind" value="resolve_task" />
                    <input type="hidden" name="task" value={task.id} />
                    <input type="hidden" name="outcome" value="resolved" />
                    <Field label="Note (optional)">
                      <TextField
                        name="note"
                        maxLength={500}
                        placeholder="What you did"
                      />
                    </Field>
                    <SubmitButton variant="outline" pendingLabel="Saving…">
                      Mark done
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={inboxAdminAction}>
                    <input type="hidden" name="kind" value="resolve_task" />
                    <input type="hidden" name="task" value={task.id} />
                    <input type="hidden" name="outcome" value="dismissed" />
                    <SubmitButton variant="quiet" pendingLabel="Dismissing…">
                      Dismiss
                    </SubmitButton>
                  </ActionForm>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

export function BrandDirectory({ brands }: { brands: DirectoryBrand[] }) {
  return (
    <Panel
      title={`Brand directory (${brands.length})`}
      description="Subscribe to each brand's newsletter with its own address; its emails then arrive here by themselves."
    >
      {brands.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No brands yet. Add the first one below.
        </p>
      ) : (
        <DataTable
          caption="Competitor brands"
          headers={[
            'Brand',
            'Subscribe with',
            'Niche',
            'Status',
            'Last email',
            'Emails',
            'Sender domains'
          ]}
        >
          {brands.map((b) => (
            <tr key={b.id} className="border-t border-[var(--line)] align-top">
              <td className="px-3 py-2">
                <span className="font-medium">{b.name}</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  {b.domain}
                </span>
                {b.sample && <Pill>Sample</Pill>}
              </td>
              <td className="px-3 py-2 font-mono text-xs break-all">
                {b.address ?? 'Set INBOX_IMAP_USER in Vercel to see it'}
              </td>
              <td className="px-3 py-2">{b.niche ?? '—'}</td>
              <td className="px-3 py-2">
                <Pill tone={subscriptionTone(b.subscription)}>
                  {b.subscription.replace('_', ' ')}
                </Pill>
              </td>
              <td className="px-3 py-2">{day(b.lastEmailAt)}</td>
              <td className="px-3 py-2">{b.emails}</td>
              <td className="px-3 py-2 text-xs">
                {b.senders.join(', ') || '—'}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      <ActionForm
        action={inboxAdminAction}
        className="mt-6 grid gap-3 sm:grid-cols-2"
      >
        <input type="hidden" name="kind" value="save_brand" />
        <Field label="Brand name">
          <TextField
            name="name"
            required
            maxLength={120}
            placeholder="Northwind Outdoor"
          />
        </Field>
        <Field label="Website domain">
          <TextField
            name="domain"
            required
            maxLength={253}
            placeholder="northwind.com"
          />
        </Field>
        <Field label="+alias (the brand's short name)">
          <TextField
            name="alias"
            required
            pattern="[a-z0-9][a-z0-9\-]{1,39}"
            placeholder="northwind"
          />
        </Field>
        <Field label="Niche">
          <TextField
            name="niche"
            required
            maxLength={60}
            placeholder="apparel"
          />
        </Field>
        <Field label="Sender domains (optional, comma separated)">
          <TextField
            name="senders"
            maxLength={2000}
            placeholder="mail.northwind.com"
          />
        </Field>
        <div className="flex items-end">
          <SubmitButton pendingLabel="Saving…">Save brand</SubmitButton>
        </div>
      </ActionForm>
    </Panel>
  )
}
