import type { Route } from 'next'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { ListRow, RowList, TextThumb } from '@/components/gros/list-row'
import { AppPage, CardRow } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { Status } from '@/components/gros/status'
import { addUpload, deleteUpload } from './actions'
import type { UploadRow, UploadsView } from './data'
import {
  acceptedDesignFiles,
  designMeans,
  designWords,
  measureFailure,
  uploadDesigns,
  uploadLimits
} from './limits'

/**
 * DES-ENGINE-003: "Add your own email" on the GROS components. The owner
 * (or an admin) uploads one .html or .eml file, says whether it is his
 * brand's own design or another brand's email, names it, and sees it in
 * the workspace's private list ("Your emails"): being read, ready, or why
 * it cannot be used. Staff see the list only. Nothing here is shown to
 * another workspace.
 */
export function UploadsScreen({
  view,
  requestKey
}: {
  view: UploadsView
  requestKey: string
}) {
  return (
    <AppPage current="inspiration" title="Add your own email">
      <Body view={view} requestKey={requestKey} />
    </AppPage>
  )
}

const inspirationHref: Route = '/inspiration'
const uploadsPage: Route = '/inspiration/add'

function Body({ view, requestKey }: { view: UploadsView; requestKey: string }) {
  if (!view.on)
    return (
      <EmptyState
        title="Not turned on yet"
        action={<ButtonLink href={inspirationHref} label="Open Inspiration" />}
      />
    )
  if (!view.ok)
    return (
      <ErrorState
        title="Your emails did not open"
        reason="We could not read your emails just now. Nothing was changed. Try again in a minute."
        action={<ButtonLink href={uploadsPage} label="Try again" />}
      />
    )
  return (
    <CardRow>
      {view.manager ? (
        <AddCard requestKey={requestKey} />
      ) : (
        <Card label="Add an email">
          <div className="flex flex-col gap-[var(--space-5)]">
            <h2 className="type-heading">Add an email</h2>
            <p className="type-body text-[var(--stone)]">
              Only the owner or an admin of this workspace can add emails.
            </p>
          </div>
        </Card>
      )}
      <YoursCard view={view} />
    </CardRow>
  )
}

function AddCard({ requestKey }: { requestKey: string }) {
  const title = 'Add an email'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        <ActionButton
          action={addUpload}
          label="Add email"
          fields={{ requestKey }}
        >
          <Field
            label="Email file (.html or .eml)"
            name="file"
            type="file"
            accept={acceptedDesignFiles}
            required
          />
          <fieldset className="flex flex-col gap-[var(--space-3)]">
            <legend className="gros-field-label mb-[var(--space-2)] text-[var(--ink)]">
              Whose design is it?
            </legend>
            {uploadDesigns.map((d) => (
              <label
                key={d}
                className="flex items-start gap-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--mist)] p-[var(--space-4)]"
              >
                <input
                  type="radio"
                  name="design"
                  value={d}
                  required
                  className="mt-[var(--space-1)] size-5 shrink-0 accent-[var(--forest)]"
                />
                <span className="flex flex-col gap-[var(--space-1)]">
                  <span className="type-body-strong">{designWords[d]}</span>
                  <span className="type-caption text-[var(--stone)]">
                    {designMeans[d]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field
            label="Name (optional)"
            name="name"
            maxLength={uploadLimits.name}
            autoComplete="off"
          />
        </ActionButton>
      </div>
    </Card>
  )
}

/** The upload's state in a pill, or nothing when it is ready. */
function stateEnd(u: UploadRow) {
  if (u.state === 'measuring') return <Status kind="working" word="Reading" />
  if (u.state === 'failed' || u.state === 'saving')
    return <Status kind="needs_you" />
  return null
}

/** The row's details, in plain words. */
export function uploadDetails(u: UploadRow): string[] {
  const out = [u.design === 'own' ? 'Your design' : 'Another brand’s email']
  if (u.state === 'ready') out.push('Ready to use')
  if (u.state === 'measuring') out.push('GROS is reading its design')
  if (u.state === 'saving')
    out.push('The upload did not finish. Add the file again')
  if (u.state === 'failed') out.push(measureFailure(u.failure))
  if (u.design === 'own') {
    if (u.pictures)
      out.push(
        u.pictures === 1 ? '1 picture kept' : `${u.pictures} pictures kept`
      )
    for (const m of u.missing)
      out.push(
        `${m.count === 1 ? '1 picture' : `${m.count} pictures`} on ${m.host} can’t be used (${m.why}): their sections will be built from library blocks, or add the email as .eml with its pictures inside`
      )
  }
  return out
}

function YoursCard({ view }: { view: Extract<UploadsView, { ok: true }> }) {
  const title = 'Your emails'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <h2 className="type-heading">{title}</h2>
          {view.uploads.length === 0 ? (
            <p className="type-body text-[var(--stone)]">
              No emails added yet. Only your workspace sees them.
            </p>
          ) : (
            <RowList label={title}>
              {view.uploads.map((u) => (
                <ListRow
                  key={u.id}
                  thumbnail={<TextThumb />}
                  title={u.name}
                  wrap
                  details={uploadDetails(u)}
                  end={
                    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                      {stateEnd(u)}
                      {/* DES-ENGINE-003b: Create email from it, on a planned email. */}
                      {u.state === 'ready' && view.owner ? (
                        <ButtonLink
                          href={`/inspiration/use?upload=${u.id}` as Route}
                          label="Use this design"
                          kind="outline"
                          size="row"
                        />
                      ) : null}
                      {view.manager ? (
                        <ActionButton
                          action={deleteUpload}
                          label="Delete"
                          kind="quiet"
                          size="row"
                          spokenLabel={`Delete: ${u.name}`}
                          fields={{ upload: u.id }}
                          confirm={`Delete “${u.name}”? Emails already made with it stay.`}
                        />
                      ) : null}
                    </div>
                  }
                />
              ))}
            </RowList>
          )}
        </ActionAnswers>
      </div>
    </Card>
  )
}
