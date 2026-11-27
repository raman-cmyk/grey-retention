import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { ListRow, RowList } from '@/components/gros/list-row'
import { AppPage, CardRow, defaultAssistant } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { pinRule, retireRule } from './actions'
import type { LearnedItem, LearnedView } from './read-model'

/**
 * Learned (UI-LRNb): the do's and don'ts the agents use for this store, in
 * two cards, each rule with where it came from and when. The owner can
 * Pin (agents read it first, it never expires) or Remove a rule; staff see
 * the list only. The page has one place for the answers, around both cards
 * and the empty state, so "Removed" stays after the last rule goes.
 * Learned is not a menu item, so nothing in the bar is current; Home's
 * "What GROS learned" card opens it.
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
      ) : (
        <ActionAnswers>
          {view.week ? (
            <WeekCard week={view.week} assistant={assistant} />
          ) : null}
          {view.do.length + view.avoid.length === 0 ? (
            // Only results fill it; Home is where the owner plans and creates.
            <EmptyState
              title="No rules in use"
              action={<ButtonLink href="/home" label="Open Home" />}
            />
          ) : (
            <CardRow>
              <RuleCard
                title="Do"
                empty="No Do rules yet."
                items={view.do}
                owner={view.owner}
              />
              <RuleCard
                title="Avoid"
                empty="No Avoid rules yet."
                items={view.avoid}
                owner={view.owner}
              />
            </CardRow>
          )}
        </ActionAnswers>
      )}
    </AppPage>
  )
}

/**
 * Owner pick #74: the weekly learning report, one plain sentence ("3 new
 * do's, 1 retired") on a small card above the rules.
 */
function WeekCard({
  week,
  assistant
}: {
  week: NonNullable<LearnedView['week']>
  assistant: string
}) {
  const title = 'This week'
  return (
    <Card label={title} size="small">
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        <div className="flex flex-col gap-[var(--space-1)]">
          <p className="type-body">{week.summary}.</p>
          <p className="type-caption text-[var(--stone)]">
            {`What ${assistant} started and stopped using in the last 7 days.`}
          </p>
        </div>
      </div>
    </Card>
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
          <RowList>
            {items.map((item) => (
              <ListRow
                key={item.id}
                thumbnail={null}
                title={item.rule}
                wrap
                details={[
                  item.pinned ? 'Pinned' : '',
                  item.sourceWords,
                  item.date
                ]}
                end={owner ? <RuleActions item={item} /> : null}
              />
            ))}
          </RowList>
        )}
      </div>
    </Card>
  )
}

/** Two actions on one rule: a design question (PROJECT_TODOS). */
function RuleActions({ item }: { item: LearnedItem }) {
  return (
    <div className="flex flex-wrap items-start gap-[var(--space-2)]">
      <ActionButton
        action={pinRule}
        label={item.pinned ? 'Unpin' : 'Pin'}
        spokenLabel={item.rule}
        kind="outline"
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
        kind="outline"
        size="row"
        fields={{ rule: item.id, revision: String(item.revision) }}
      />
    </div>
  )
}
