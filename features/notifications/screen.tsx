import { CalendarDays, ChartColumn, Mail } from 'lucide-react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink, buttonClasses } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { ListRow, RowList } from '@/components/gros/list-row'
import { AppPage, defaultAssistant } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { markAllNoticesRead, openNotice, setNoticeEmail } from './actions'
import type { NoticesView } from './read-model'
import type { Notice, NoticeKind } from './view'

/**
 * Notifications (PICK-107): the person's notices, latest first, each one
 * plain line and an Open button that marks it read and opens its page;
 * how many are new, and Mark all read. Beside it, the owner's email
 * switch (off unless he turns it on; this build only records the emails).
 * Opened from the bell in the top bar, which is then current. Email is
 * the owner's only, for a ready plan and drafts (results stay in the app).
 */
export function NotificationsScreen({
  view,
  assistant = defaultAssistant
}: {
  view: NoticesView
  assistant?: string
}) {
  return (
    <AppPage
      current="notices"
      title="Notifications"
      assistant={assistant}
      // The bell shows the count this page read (again after Open or Mark
      // all read), rather than asking a second time.
      notices={view.state === 'ready' ? view.unread : 'ask'}
    >
      {view.state === 'unread' ? (
        <ErrorState
          title="Notifications did not open"
          reason="We could not read them just now. Nothing is lost: try again in a minute."
          action={<ButtonLink href="/notifications" label="Try again" />}
        />
      ) : view.state === 'demo' ? (
        <EmptyState
          title="Nothing kept in the demo"
          action={<ButtonLink href="/home" label="Open Home" />}
        />
      ) : (
        <ActionAnswers>
          {view.items.length === 0 ? (
            <EmptyState
              title="No notifications yet"
              action={<ButtonLink href="/plan" label="Plan next 15 days" />}
            />
          ) : (
            <ListCard items={view.items} unread={view.unread} />
          )}
          <EmailCard on={view.emailOn} owner={view.owner} />
        </ActionAnswers>
      )}
    </AppPage>
  )
}

function ListCard({ items, unread }: { items: Notice[]; unread: number }) {
  return (
    <Card label="Your notifications">
      <div className="flex flex-col gap-[var(--space-5)]">
        <div className="flex flex-col gap-[var(--space-1)]">
          <p className="type-label text-[var(--stone)]">New</p>
          <p className="type-number-lg">{unread}</p>
        </div>
        <RowList label="Notifications">
          {items.map((item) => (
            <ListRow
              key={item.id}
              wrap
              thumbnail={<KindThumb kind={item.kind} />}
              title={item.line}
              details={[item.unread ? 'New' : '', item.at]}
              end={
                <form action={openNotice}>
                  <input type="hidden" name="notice" value={item.id} />
                  <button
                    type="submit"
                    aria-label={`Open: ${item.line}`}
                    className={buttonClasses('outline', 'row')}
                  >
                    Open
                  </button>
                </form>
              }
            />
          ))}
        </RowList>
        {unread > 0 ? (
          <div>
            <ActionButton action={markAllNoticesRead} label="Mark all read" />
          </div>
        ) : null}
      </div>
    </Card>
  )
}

const kindIcons: Record<NoticeKind, typeof Mail> = {
  plan_ready: CalendarDays,
  drafts_ready: Mail,
  results_in: ChartColumn
}

function KindThumb({ kind }: { kind: NoticeKind }) {
  const Icon = kindIcons[kind]
  return (
    <span
      aria-hidden
      className="gros-thumb flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
    >
      <Icon size={18} strokeWidth={2} />
    </span>
  )
}

/** The owner's email switch. Staff see how it is set. */
function EmailCard({ on, owner }: { on: boolean; owner: boolean }) {
  return (
    <Card size="small" label="Email">
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">Email</h2>
        <div className="flex flex-col gap-[var(--space-1)]">
          <p className="type-number-lg">{on ? 'On' : 'Off'}</p>
          <p className="type-caption text-[var(--stone)]">
            {on
              ? 'A ready plan and new drafts are also emailed to you. This build records the emails but sends none yet.'
              : 'Notifications stay in the app. Turn on to also email you when a plan or drafts are ready.'}
          </p>
        </div>
        {owner ? (
          <div>
            <ActionButton
              action={setNoticeEmail}
              label={on ? 'Turn off emails' : 'Turn on emails'}
              kind="outline"
              fields={{ turn: on ? 'off' : 'on' }}
            />
          </div>
        ) : (
          <p className="type-caption text-[var(--stone)]">
            Only the owner changes this.
          </p>
        )}
      </div>
    </Card>
  )
}
