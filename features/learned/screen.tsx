import { ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { AppPage, CardRow, defaultAssistant } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { pinRule, retireRule } from './actions'
import type { LearnedItem, LearnedView } from './read-model'

/**
 * Learned (UI-LRNb): the do's and don'ts the agents use for this store, in
 * two cards, each rule with where it came from and when. The owner can
 * Pin (agents read it first, it never expires) or Remove a rule; staff see
 * the list only. Learned is not a menu item, so nothing in the bar is
 * current; Home's "What GROS learned" card opens it.
 */
export function LearnedScreen({
  view,
  assistant = defaultAssistant
}: {
  view: LearnedView
  /** The assistant's name (the white label may rename it). */
  assistant?: string
}) {
  return (
    <AppPage title="Learned" assistant={assistant}>
      {view.unread ? (
        <ErrorState
          title="Learned did not open"
          reason={`We could not read what ${assistant} learned just now. Its rules are safe. Try again in a minute.`}
          action={<ButtonLink href="/learned" label="Try again" />}
        />
      ) : view.do.length + view.avoid.length === 0 ? (
        // Nothing the owner can do fills it: the agents learn from results.
        <EmptyState title="No rules in use" action={null} />
      ) : (
        <CardRow>
          <RuleCard
            title="Do"
            empty={`${assistant} uses no do rule yet.`}
            items={view.do}
            owner={view.owner}
          />
          <RuleCard
            title="Avoid"
            empty={`${assistant} uses no avoid rule yet.`}
            items={view.avoid}
            owner={view.owner}
          />
        </CardRow>
      )}
    </AppPage>
  )
}

function RuleCard({
  title,
  empty,
  items,
  owner
}: {
  title: string
  empty: string
  items: LearnedItem[]
  owner: boolean
}) {
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {items.length === 0 ? (
          <p className="type-body text-[var(--stone)]">{empty}</p>
        ) : (
          <ul aria-label={title} className="flex flex-col gap-[var(--space-2)]">
            {items.map((item) => (
              <RuleItem key={item.id} item={item} owner={owner} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function RuleItem({ item, owner }: { item: LearnedItem; owner: boolean }) {
  const details = [item.pinned ? 'Pinned' : '', item.sourceWords, item.date]
  return (
    <li className="gros-tile flex flex-wrap items-start justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--mist)]">
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)]">
        <p className="type-body-strong break-words">{item.rule}</p>
        {item.why ? (
          <p className="type-caption break-words text-[var(--stone)]">
            {item.why}
          </p>
        ) : null}
        <p className="type-caption text-[var(--stone)]">
          {details.filter(Boolean).join(' · ')}
        </p>
      </div>
      {owner ? (
        // Two quiet actions on one rule: a design question (PROJECT_TODOS).
        <div className="flex flex-wrap items-start gap-[var(--space-3)]">
          <ActionButton
            action={pinRule}
            label={item.pinned ? 'Unpin' : 'Pin'}
            spokenLabel={item.rule}
            kind="quiet"
            size="row"
            fields={{
              rule: item.id,
              revision: String(item.revision),
              pinned: String(!item.pinned)
            }}
          />
          <ActionButton
            action={retireRule}
            label="Remove"
            spokenLabel={item.rule}
            kind="quiet"
            size="row"
            fields={{ rule: item.id, revision: String(item.revision) }}
          />
        </div>
      ) : null}
    </li>
  )
}
