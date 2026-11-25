import { ButtonLink, buttonClasses } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { AppPage, CardRow } from '@/components/gros/nav'
import { Progress } from '@/components/gros/progress'
import { Status } from '@/components/gros/status'
import { ErrorState } from '@/components/gros/states'
import { KeepFresh } from '@/features/strategy/refresh'
import type {
  EmailScreen as View,
  EmailView,
  KlaviyoLink
} from './email-screen'
import { EmailViews } from './email-views'

/**
 * An email's own page (UI-EMAIL-b): the email read model (UI-EMAIL-a) on the
 * GROS components, for a designed email and a text email alike. Its steps
 * while it is made, why it stopped, or the email: its subject and preview
 * line, its designs at desktop, phone and dark, a text email's plain text,
 * what the team changed, and Open in Klaviyo for a real draft.
 */
export function EmailScreen({ view }: { view: View }) {
  const title =
    view.kind === 'email'
      ? view.title
      : view.kind === 'failed' && view.email
        ? view.email.title
        : 'Your email'
  return (
    <AppPage current="plan" title={title}>
      <Body view={view} />
    </AppPage>
  )
}

const backToPlan = (
  <ButtonLink href="/plan" label="Back to the plan" kind="outline" />
)

function Body({ view }: { view: View }) {
  const steps = view.steps.map((s) => ({ text: s.label, state: s.state }))
  switch (view.kind) {
    case 'working':
      return (
        <Card>
          <Progress
            title={
              view.format === 'text'
                ? 'Creating your text email'
                : 'Creating your email'
            }
            steps={steps}
          />
          <KeepFresh />
          <Notes notes={view.notes} />
          <div className="mt-[var(--space-6)]">{backToPlan}</div>
        </Card>
      )
    case 'failed':
      return (
        <>
          <Card>
            <Progress
              title={
                view.email
                  ? 'This email was not put in Klaviyo'
                  : 'This email was not made'
              }
              steps={view.steps.map((s) => ({
                text: s.label,
                state: s.state,
                reason: s.state === 'failed' ? view.reason : undefined
              }))}
              retry={backToPlan}
            />
            <Notes notes={view.notes} />
          </Card>
          {view.email && <Designs email={view.email} />}
        </>
      )
    case 'unreadable':
      return (
        <ErrorState
          title="This email can’t be shown"
          reason={view.message}
          action={
            view.klaviyo ? <KlaviyoButton link={view.klaviyo} /> : backToPlan
          }
        />
      )
    case 'email':
      return (
        <>
          <CardRow>
            <Summary view={view} />
            <Card>
              <h2 className="type-heading">How it was made</h2>
              <ul className="mt-[var(--space-5)] flex flex-col gap-[var(--space-2)]">
                {view.steps.map((s) => (
                  <li key={s.label} className="type-body">
                    {s.label}
                  </li>
                ))}
              </ul>
              <Notes notes={view.notes} />
              {view.status === 'working' && <KeepFresh />}
            </Card>
          </CardRow>
          {view.copied && <Copied lines={view.copied} />}
          <Designs email={view} />
        </>
      )
  }
}

/**
 * DES-ENGINE-002b2: how the email you chose in Inspiration was copied:
 * the first line says it, each next one names a section built from a
 * library block (or left out) and why.
 */
function Copied({ lines }: { lines: readonly string[] }) {
  const [first, ...sections] = lines
  return (
    <Card>
      <h2 className="type-heading">The design you chose</h2>
      <p className="type-body mt-[var(--space-5)]">{first}</p>
      {sections.length > 0 && (
        <ul className="mt-[var(--space-4)] flex flex-col gap-[var(--space-2)]">
          {sections.map((line) => (
            <li key={line} className="type-body">
              {line}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Open in Klaviyo: Klaviyo's campaigns list, where the draft is by its name. */
function KlaviyoButton({ link }: { link: KlaviyoLink }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses('main', 'app')}
    >
      Open in Klaviyo
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function Summary({ view }: { view: Extract<View, { kind: 'email' }> }) {
  const sampleDraft = view.status === 'sample_draft'
  return (
    <Card label="The email">
      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        {view.status === 'in_klaviyo' && <Status kind="in_klaviyo" />}
        {view.status === 'working' && (
          <Status kind="working" word="Adding to Klaviyo" />
        )}
        {sampleDraft && <Status kind="planned" />}
        <p className="type-caption text-[var(--stone)]">
          {view.format === 'text' ? 'Text email' : 'Designed email'}
        </p>
      </div>
      <dl className="mt-[var(--space-5)] flex flex-col gap-[var(--space-4)]">
        <div>
          <dt className="type-label">Subject</dt>
          <dd className="type-body-strong">{view.subject}</dd>
        </div>
        {view.subjectB && (
          <div>
            <dt className="type-label">Subject B (half the audience)</dt>
            <dd className="type-body-strong">{view.subjectB}</dd>
          </div>
        )}
        <div>
          <dt className="type-label">Preview line</dt>
          <dd className="type-body">{view.preview}</dd>
        </div>
      </dl>
      {(sampleDraft || view.sample) && (
        <ul className="mt-[var(--space-5)] flex flex-col gap-[var(--space-2)]">
          {sampleDraft && (
            <li className="type-caption text-[var(--stone)]">
              Klaviyo is not connected yet, so this is a sample draft: nothing
              was sent to Klaviyo.
            </li>
          )}
          {view.sample && (
            <li className="type-caption text-[var(--stone)]">
              Made from the sample store until your own store is connected: the
              products and offers are examples.
            </li>
          )}
        </ul>
      )}
      <div className="mt-[var(--space-6)] flex flex-wrap gap-[var(--space-3)]">
        {view.klaviyo && <KlaviyoButton link={view.klaviyo} />}
        {backToPlan}
      </div>
      {view.klaviyo && (
        <p className="type-caption mt-[var(--space-3)] text-[var(--stone)]">
          {view.klaviyo.name
            ? `In Klaviyo’s campaigns, it is called “${view.klaviyo.name}”.`
            : 'Find it in Klaviyo’s campaigns.'}{' '}
          It waits there as a draft: you schedule it in Klaviyo when you are
          ready.
        </p>
      )}
    </Card>
  )
}

/** Each design to look at, and a text email’s plain text. */
function Designs({ email }: { email: EmailView }) {
  return (
    <>
      {email.designs.map((d) => (
        <Card key={d.name}>
          <h2 className="type-heading mb-[var(--space-5)]">{d.name}</h2>
          <EmailViews name={d.name} html={d.html} />
        </Card>
      ))}
      {email.text && (
        <Card>
          <h2 className="type-heading">Its plain text</h2>
          <pre className="type-body mt-[var(--space-5)] whitespace-pre-wrap">
            {email.text}
          </pre>
        </Card>
      )}
    </>
  )
}

function Notes({ notes }: { notes: readonly string[] }) {
  if (!notes.length) return null
  return (
    <ul className="mt-[var(--space-5)] flex flex-col gap-[var(--space-2)]">
      {notes.map((n) => (
        <li key={n} className="type-caption text-[var(--stone)]">
          {n}
        </li>
      ))}
    </ul>
  )
}
