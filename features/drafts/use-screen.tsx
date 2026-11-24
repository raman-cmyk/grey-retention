import type { Route } from 'next'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'
import { toSafePreview } from '@/features/email-generation/to-safe-preview'
import { pastedLimits, readableAtLimit } from '@/features/references/pasted'
import {
  importedSource,
  type DraftReference,
  type ImportedDraftReference
} from './sources'
import { UseDesignForm } from './use-form'

/**
 * "Use this design" (UI-OLDc): the GROS screen that starts a draft from an
 * Inspiration email, replacing the old `/first-draft` page. Create email on
 * the Plan picks its own Inspiration email (Copy or Remix) and takes no
 * chosen one, so this screen keeps the old first-draft action: a saved
 * draft that follows the chosen email's sections, never its words, images
 * or offers. With no email chosen it starts from scratch.
 */
export type UseDesignView =
  | { kind: 'error' }
  | { kind: 'staff' }
  | { kind: 'missing' }
  | {
      kind: 'form'
      reference: DraftReference | null
      imported: ImportedDraftReference | null
      requestKey: string
      defaultTitle: string
      defaultDate: string
      timezone: string
      audiences: { id: string; label: string }[]
    }

const inspirationHref: Route = '/inspiration'

/** The page title: 1 to 4 words (BRAND.md rule 16). */
export function designTitle(view: UseDesignView) {
  return view.kind === 'form' && !view.reference && !view.imported
    ? 'New draft'
    : 'Use this design'
}

export function UseDesignScreen({ view }: { view: UseDesignView }) {
  const title = designTitle(view)
  return (
    <AppPage current="inspiration" title={title}>
      {view.kind === 'error' ? (
        <ErrorState
          title="This page did not open"
          reason="We could not read your emails just now. Nothing was saved. Try again in a minute."
          action={
            <ButtonLink href={inspirationHref} label="Back to Inspiration" />
          }
        />
      ) : view.kind === 'missing' ? (
        <ErrorState
          title="This email is gone"
          reason="The email you chose is no longer in your Inspiration. Choose another one there."
          action={
            <ButtonLink href={inspirationHref} label="Open Inspiration" />
          }
        />
      ) : view.kind === 'staff' ? (
        <Card>
          <div className="flex flex-col items-start gap-[var(--space-5)]">
            <h2 className="type-heading">Only the owner creates drafts</h2>
            <ButtonLink
              href={inspirationHref}
              label="Back to Inspiration"
              kind="outline"
            />
          </div>
        </Card>
      ) : (
        <>
          {view.reference || view.imported ? <ChosenEmail view={view} /> : null}
          <Card label="The draft">
            <div className="flex flex-col gap-[var(--space-6)]">
              <h2 className="type-heading">Your draft</h2>
              <UseDesignForm
                requestKey={view.requestKey}
                source={
                  view.imported
                    ? importedSource(view.imported.id)
                    : (view.reference?.id ?? 'original')
                }
                defaultTitle={view.defaultTitle}
                defaultDate={view.defaultDate}
                timezone={view.timezone}
                audiences={view.audiences}
              />
            </div>
          </Card>
        </>
      )}
    </AppPage>
  )
}

/** The chosen email: what is kept (its sections) and what is not. */
function ChosenEmail({
  view
}: {
  view: Extract<UseDesignView, { kind: 'form' }>
}) {
  const subject = view.imported?.subject ?? view.reference?.subject ?? ''
  const at = view.imported?.created_at ?? view.reference?.received_at
  return (
    <Card label="The email you chose">
      <div className="flex flex-col gap-[var(--space-5)]">
        <div className="flex flex-col gap-[var(--space-2)]">
          <h2 className="type-heading break-words">{subject}</h2>
          <p className="type-caption text-[var(--stone)]">
            {[
              view.imported ? 'Added by you' : 'From a brand you follow',
              at ? day(at, view.timezone) : '',
              view.imported?.source_description ?? ''
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <p className="type-body">
          {view.imported?.structure.length
            ? `Your draft follows its sections (${view.imported.structure.join(', ')}).`
            : 'Your draft follows its sections.'}{' '}
          Its words, pictures and offers are not copied.
        </p>
        {view.reference ? (
          <iframe
            title={`The email: ${subject}`}
            sandbox=""
            referrerPolicy="no-referrer"
            // Sanitized again on the server: links removed, a strict CSP.
            srcDoc={toSafePreview(view.reference.safe_html)?.html ?? ''}
            className="h-[28rem] w-full max-w-[600px] rounded-[var(--radius-md)] bg-[var(--white)]"
          />
        ) : view.imported ? (
          // Shown as text only: pasted markup is never interpreted.
          <>
            <p className="type-body max-h-[28rem] overflow-auto rounded-[var(--radius-md)] bg-[var(--mist)] p-[var(--space-4)] break-words whitespace-pre-wrap">
              {view.imported.readable_text}
            </p>
            {readableAtLimit(view.imported.readable_text) ? (
              <p className="type-caption text-[var(--stone)]">
                Shown up to the first{' '}
                {pastedLimits.readable.toLocaleString('en')} characters. The
                full email you added is saved unchanged.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Card>
  )
}

function day(iso: string, timezone: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: timezone
    }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}
