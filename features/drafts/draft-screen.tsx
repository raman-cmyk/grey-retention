import type { Route } from 'next'
import type { ReactNode } from 'react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { AppPage, CardRow } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'
import { Status } from '@/components/gros/status'
import {
  addNote,
  approveCalendar,
  saveCampaign
} from '@/features/campaigns/actions'
import { workflowAction } from '@/features/campaigns/workflow-actions'
import { CopyFields, DetailFields, NoteField } from './draft-fields'
import type { DraftView } from './draft-view'

/**
 * A saved draft (UI-OLDc), the GROS page for a draft made with "Use this
 * design"; it replaces the old campaign page at `/campaigns/<id>`. The
 * owner approves the date, then the copy is written (by the scheduled
 * worker), saved and approved here, with the old page's own server
 * actions. The old page's designer review, sample delivery package and
 * simulated scheduling are not here: D3, D17 and D21 replaced them with
 * Create email on the Plan, which puts a draft in Klaviyo.
 */
export const planHref: Route = '/plan'

export function DraftError() {
  return (
    <AppPage current="plan" title="Your draft">
      <ErrorState
        title="This draft did not open"
        reason="We could not read it just now. It is safe: try again in a minute."
        action={<ButtonLink href={planHref} label="Back to the plan" />}
      />
    </AppPage>
  )
}

export function DraftScreen({ view }: { view: DraftView }) {
  return (
    <AppPage current="plan" title="Your draft">
      <CardRow>
        <AboutCard view={view} />
        <CopyCard view={view} />
      </CardRow>
      <CardRow>
        <DetailsCard view={view} />
        <StepsCard view={view} />
      </CardRow>
      <NotesCard view={view} />
    </AppPage>
  )
}

function Tiles({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid w-full gap-[var(--space-3)] sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="gros-tile flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] bg-[var(--mist)]"
        >
          <dt className="type-label text-[var(--stone)]">{label}</dt>
          <dd className="type-body-strong break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function AboutCard({ view }: { view: DraftView }) {
  return (
    <Card label="The draft">
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
            <h2 className="type-heading min-w-0 break-words">{view.title}</h2>
            {view.status ? (
              <Status kind={view.status} />
            ) : (
              <span className="type-caption text-[var(--stone)]">
                Replaced by a newer plan
              </span>
            )}
          </div>
          {view.goal ? (
            <p className="type-body break-words whitespace-pre-wrap">
              {view.goal}
            </p>
          ) : null}
          <Tiles items={view.facts} />
          {view.approveDate !== null ? (
            <ActionButton
              action={approveCalendar}
              label="Approve date"
              fields={{ id: view.id, revision: String(view.approveDate) }}
            />
          ) : null}
        </ActionAnswers>
      </div>
    </Card>
  )
}

function CopyCard({ view }: { view: DraftView }) {
  const copy = view.copy
  return (
    <Card label="Copy">
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <h2 className="type-heading">Copy</h2>
          {copy.kind === 'wait' ? (
            <p className="type-body text-[var(--stone)]">
              {view.owner
                ? 'Approve the date first. Then the copy is written.'
                : 'The owner approves the date first. Then the copy is written.'}
            </p>
          ) : copy.kind === 'none' ? (
            <>
              <p className="type-body text-[var(--stone)]">
                The copy is not written yet.
              </p>
              {copy.write !== null ? (
                <ActionButton
                  action={workflowAction}
                  label="Write copy"
                  fields={{
                    kind: 'generate_copy',
                    id: view.id,
                    revision: String(copy.write)
                  }}
                />
              ) : null}
            </>
          ) : (
            <>
              {copy.problems.length ? (
                <ul className="type-body flex flex-col gap-[var(--space-1)] text-[var(--signal-ink)]">
                  {copy.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
              {copy.edit ? (
                <ActionButton
                  key={copy.revision}
                  action={workflowAction}
                  label="Save copy"
                  kind={copy.approve ? 'outline' : 'main'}
                  fields={{
                    kind: 'save_copy',
                    id: view.id,
                    revision: String(copy.revision)
                  }}
                >
                  <CopyFields copy={copy} />
                </ActionButton>
              ) : (
                <Tiles
                  items={[
                    ['Subject', copy.subject],
                    ['Preview text', copy.preheader || 'None'],
                    ['Button', copy.cta],
                    ['Button link', copy.url]
                  ]}
                />
              )}
              {!copy.edit ? (
                <p className="type-body break-words whitespace-pre-wrap">
                  {copy.body}
                </p>
              ) : null}
              <div className="flex flex-wrap items-start gap-[var(--space-3)]">
                {copy.approve ? (
                  <ActionButton
                    action={workflowAction}
                    label="Approve copy"
                    fields={{
                      kind: 'approve_copy',
                      id: view.id,
                      revision: String(copy.revision)
                    }}
                  />
                ) : null}
                {copy.rewrite ? (
                  <ActionButton
                    action={workflowAction}
                    label="Write again"
                    kind="quiet"
                    fields={{
                      kind: 'generate_copy',
                      id: view.id,
                      revision: String(copy.revision)
                    }}
                  />
                ) : null}
              </div>
              {copy.approved ? (
                <p className="type-body">
                  {view.owner
                    ? 'You approved this copy.'
                    : 'The owner approved this copy.'}
                </p>
              ) : null}
            </>
          )}
        </ActionAnswers>
      </div>
    </Card>
  )
}

function DetailsCard({ view }: { view: DraftView }) {
  const details = view.details
  return (
    <Card label="Details">
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">Details</h2>
        {details ? (
          <ActionButton
            key={details.revision}
            action={saveCampaign}
            label="Save changes"
            fields={{ id: view.id, revision: String(details.revision) }}
          >
            <DetailFields draft={details} audiences={view.audiences} />
          </ActionButton>
        ) : (
          <p className="type-body text-[var(--stone)]">
            A newer plan replaced this draft. It is kept as it was.
          </p>
        )}
      </div>
    </Card>
  )
}

function StepsCard({ view }: { view: DraftView }) {
  return (
    <Card label="Progress">
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">Progress</h2>
        <Tiles items={view.steps} />
      </div>
    </Card>
  )
}

function NotesCard({ view }: { view: DraftView }) {
  return (
    <Card label="Notes">
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <h2 className="type-heading">Notes</h2>
          {view.notes.length ? (
            <ul className="flex flex-col gap-[var(--space-3)]">
              {view.notes.map((n) => (
                <li
                  key={n.id}
                  className="type-body rounded-[var(--radius-md)] bg-[var(--mist)] p-[var(--space-4)] break-words whitespace-pre-wrap"
                >
                  {n.body}
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-body text-[var(--stone)]">No notes yet.</p>
          )}
          <ActionButton
            action={addNote}
            label="Save note"
            kind="outline"
            fields={{ id: view.id }}
          >
            <NoteField />
          </ActionButton>
        </ActionAnswers>
      </div>
    </Card>
  )
}
