import { randomUUID } from 'node:crypto'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import type { Route } from 'next'
import { Download } from 'lucide-react'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Field, Notice, Panel, controlClass } from '@/components/ui/workspace'
import {
  chooseEmailOutcome,
  restoreEmailVersion,
  rewriteAgain,
  saveEmailVersion
} from './actions'
import { rewriteAvailability } from './config'
import { emailResult } from './data'
import { fileForReference } from '@/features/email-import/data'
import { htmlEditable, suggestedPrimary } from './html'
import { EmailPreview } from './preview'
import { htmlFingerprint } from './rewrite'
import { RewriteProgress } from './progress'

const originLabel: Record<string, string> = {
  exact_copy: 'Exact copy',
  ai_rewrite: 'Rewritten with AI',
  sample_rewrite: 'Sample text (not AI)',
  owner_edit: 'Your edit',
  restored: 'Restored'
}

/** Owner-facing failure text: actionable, without provider or job details. */
const failureText: Record<string, string> = {
  setup_required:
    'Rewriting is not set up yet. An administrator needs to finish the AI setup.',
  provider_account:
    'The AI account needs attention (billing or access). An administrator can fix this.',
  budget_exhausted:
    'This workspace has used its AI allowance for now. Try again later.',
  refused:
    'The AI declined to rewrite this email. Try different focus notes, or copy it instead.',
  incomplete:
    'The rewrite came back unfinished. Try again, perhaps with a shorter email.',
  timeout:
    'We did not hear back in time, so we stopped instead of trying again automatically.',
  unknown_outcome:
    'We could not confirm whether the rewrite finished, so we stopped instead of trying again automatically.',
  unavailable: 'The AI service was unavailable. Try again in a moment.',
  rate_limited: 'The AI service was busy. Try again in a moment.',
  stale_inputs:
    'Your brand details or this email changed while it was being rewritten, so that result was not applied.',
  actor_inactive:
    'The person who asked for this rewrite no longer has owner access.',
  attempts_exhausted: 'The rewrite did not succeed after several tries.'
}

function download(resultId: string, part: string, version?: number) {
  return `/api/v1/emails/${resultId}/export?part=${part}${version ? `&version=${version}` : ''}` as Route
}

export async function EmailResultView({
  tenantId,
  resultId,
  version,
  owner
}: {
  tenantId: string
  resultId: string
  version?: number
  owner: boolean
}) {
  const { data, error } = await emailResult(tenantId, resultId, version)
  if (!data)
    return (
      <Notice error={!!error}>
        {error ?? 'This email is not available in this workspace.'}
      </Notice>
    )
  const { result, source, revision, revisions, generations, campaign } = data
  const file = await fileForReference(tenantId, source.reference_import_id)
  const latest = generations[0]
  const writing = latest && ['queued', 'running'].includes(latest.state)
  // A failure is shown until a newer version is saved.
  const failed =
    !!latest &&
    ['failed', 'stale'].includes(latest.state) &&
    (!revisions[0] ||
      Date.parse(revisions[0].created_at) < Date.parse(latest.created_at))
  const current = revision && revision.revision === result.current_revision
  const deliveryActive = [
    'queued',
    'preparing',
    'prepared',
    'scheduling',
    'scheduled',
    'sent',
    'reconciling'
  ].includes(campaign.delivery_state)
  const availability = rewriteAvailability(tenantId)
  const html = source.format === 'html'
  // Approval belongs to the campaign copy; this version is only "approved" if
  // it is still the campaign's current copy revision.
  const synced =
    !!revision && revision.campaign_copy_revision === campaign.copy_revision
  const status = !revision
    ? 'Not saved yet'
    : !current
      ? 'Earlier version'
      : !synced
        ? 'Changed in campaign review since this version'
        : campaign.copy_state === 'approved'
          ? 'Approved'
          : campaign.copy_state === 'rejected'
            ? 'Changes requested'
            : 'Waiting for your approval'
  const approved = synced && current && campaign.copy_state === 'approved'
  const editable =
    revision?.html && current ? htmlEditable(revision.html) : null
  const rawForm = revision ? (
    <ActionForm
      key={`raw-${revision.revision}`}
      preserveValues
      action={saveEmailVersion}
      className="space-y-4"
    >
      <input type="hidden" name="resultId" value={result.id} />
      <input type="hidden" name="revision" value={revision.revision} />
      <Field label="Subject line">
        <TextField
          name="subject"
          defaultValue={revision.subject}
          maxLength={200}
          required
        />
      </Field>
      <Field label="Preview text">
        <TextField
          name="preheader"
          defaultValue={revision.preheader}
          maxLength={300}
        />
      </Field>
      {revision.html !== null && (
        <Field label="Email HTML">
          <textarea
            name="html"
            rows={12}
            defaultValue={revision.html}
            maxLength={300000}
            spellCheck={false}
            className={cn(controlClass, 'font-mono text-xs')}
          />
        </Field>
      )}
      <Field
        label={revision.html !== null ? 'Plain-text version' : 'Email text'}
      >
        <textarea
          name="body"
          rows={10}
          defaultValue={revision.body_text}
          maxLength={100000}
          className={controlClass}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Button label">
          <TextField
            name="cta"
            defaultValue={revision.cta_label}
            maxLength={200}
          />
        </Field>
        <Field label="Button link">
          <TextField
            name="url"
            defaultValue={revision.cta_url}
            inputMode="url"
            placeholder="https://"
            maxLength={2000}
          />
        </Field>
      </div>
      <p className="text-xs leading-5 text-[var(--text-muted)]">
        {revision.html !== null
          ? 'Here the HTML, plain-text version and button details are saved exactly as entered; they do not update each other.'
          : 'Saving keeps this version and adds a new one.'}{' '}
        A button label and https:// link are needed before approval.
      </p>
      <SubmitButton variant="secondary">Save as new version</SubmitButton>
    </ActionForm>
  ) : null
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-72">
          <p className="text-xs text-[var(--text-muted)]">
            {revision
              ? originLabel[revision.origin]
              : result.mode === 'copy'
                ? 'Exact copy'
                : 'Rewrite for your brand'}{' '}
            · <span data-testid="approval-status">{status}</span>
            {revision ? ` · Version ${revision.revision}` : ''}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight break-words sm:text-3xl">
            {revision?.subject ?? source.subject}
          </h1>
        </div>
        {revision &&
          (current ? (
            <Button asChild>
              <Link href={`/campaigns/${campaign.id}#copy` as Route}>
                {approved
                  ? 'Open campaign'
                  : synced
                    ? 'Review and approve'
                    : 'Open campaign review'}
              </Link>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link href={`/emails/${result.id}` as Route}>
                Back to the latest version
              </Link>
            </Button>
          ))}
      </header>
      {error && (
        <div className="mb-5">
          <Notice error>{error}</Notice>
        </div>
      )}
      {writing && (
        <div className="mb-5">
          <RewriteProgress resultId={result.id} />
        </div>
      )}
      {!writing && failed && latest && (
        <div className="mb-5 space-y-3">
          <Notice error>
            {failureText[latest.failure_code ?? ''] ??
              'The rewrite did not finish. Your email and earlier versions are safe.'}
          </Notice>
          {owner && (
            <div className="flex flex-wrap gap-3">
              {availability.ready && !deliveryActive && (
                <ActionForm action={rewriteAgain}>
                  <input type="hidden" name="resultId" value={result.id} />
                  <input
                    type="hidden"
                    name="revision"
                    value={result.current_revision}
                  />
                  <input type="hidden" name="attempt" value={randomUUID()} />
                  <SubmitButton variant="secondary">
                    Try the rewrite again
                  </SubmitButton>
                </ActionForm>
              )}
              {result.current_revision === 0 && (
                <ActionForm action={chooseEmailOutcome}>
                  <input type="hidden" name="attempt" value={result.id} />
                  <input
                    type="hidden"
                    name="importId"
                    value={source.reference_import_id}
                  />
                  <input type="hidden" name="mode" value="copy" />
                  <SubmitButton variant="secondary">
                    Copy the original instead
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
        </div>
      )}
      {!revision ? (
        !writing &&
        !failed && <Notice>Nothing has been saved for this email yet.</Notice>
      ) : (
        <div className="mx-auto max-w-3xl space-y-5">
          <EditSection current={!!current} revision={revision.revision}>
            {!current ? (
              <div className="space-y-4 text-sm">
                <p className="text-[var(--text-muted)]">
                  You are looking at an earlier version.
                </p>
                <Link
                  href={`/emails/${result.id}` as Route}
                  className="block underline underline-offset-4"
                >
                  Back to the latest version
                </Link>
                {owner && !deliveryActive && (
                  <ActionForm action={restoreEmailVersion}>
                    <input type="hidden" name="resultId" value={result.id} />
                    <input
                      type="hidden"
                      name="revision"
                      value={result.current_revision}
                    />
                    <input
                      type="hidden"
                      name="from"
                      value={revision.revision}
                    />
                    <SubmitButton variant="secondary">
                      Restore this version
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            ) : owner && !deliveryActive && editable ? (
              <>
                <ActionForm
                  key={revision.revision}
                  preserveValues
                  action={saveEmailVersion}
                  className="space-y-4"
                >
                  <input type="hidden" name="editor" value="blocks" />
                  <input type="hidden" name="resultId" value={result.id} />
                  <input
                    type="hidden"
                    name="revision"
                    value={revision.revision}
                  />
                  <input
                    type="hidden"
                    name="fingerprint"
                    value={htmlFingerprint(revision.html!)}
                  />
                  <Field label="Subject line">
                    <TextField
                      name="subject"
                      defaultValue={revision.subject}
                      maxLength={200}
                      required
                    />
                  </Field>
                  <Field label="Preview text">
                    <TextField
                      name="preheader"
                      defaultValue={revision.preheader}
                      maxLength={300}
                    />
                  </Field>
                  <fieldset className="space-y-3">
                    <legend className="mb-2 text-sm font-medium">
                      Text in the email
                    </legend>
                    {editable.segments.map((segment) => (
                      <Field key={segment.id} label={`Text ${segment.id + 1}`}>
                        {segment.text.length > 80 ? (
                          <textarea
                            name={`text-${segment.id}`}
                            rows={3}
                            defaultValue={segment.text}
                            maxLength={2000}
                            className={controlClass}
                          />
                        ) : (
                          <TextField
                            name={`text-${segment.id}`}
                            defaultValue={segment.text}
                            maxLength={2000}
                          />
                        )}
                      </Field>
                    ))}
                  </fieldset>
                  {editable.links.length > 0 && (
                    <fieldset className="space-y-3">
                      <legend className="mb-2 text-sm font-medium">
                        Links in the email
                      </legend>
                      {editable.links.map((link) => (
                        <Field
                          key={link.id}
                          label={
                            link.text
                              ? `Link “${link.text}”`
                              : `Link ${link.id + 1} (image)`
                          }
                        >
                          <TextField
                            name={`link-${link.id}`}
                            defaultValue={link.href}
                            inputMode="url"
                            maxLength={2000}
                          />
                        </Field>
                      ))}
                      <p className="text-xs leading-5 text-[var(--text-muted)]">
                        Changed links must be full https:// addresses. Links you
                        do not change stay as they are.
                      </p>
                    </fieldset>
                  )}
                  {editable.links.length > 0 && (
                    <Field label="Main button">
                      <select
                        name="primary"
                        defaultValue={String(
                          suggestedPrimary(editable.links, revision.cta_url)
                            ?.id ?? 'none'
                        )}
                        className={controlClass}
                      >
                        {editable.links.map((link) => (
                          <option
                            key={link.id}
                            value={link.id}
                            disabled={!link.text}
                          >
                            {link.text
                              ? `“${link.text}”`
                              : `Link ${link.id + 1} (image only)`}
                          </option>
                        ))}
                        <option value="none">No main button yet</option>
                      </select>
                    </Field>
                  )}
                  <p className="text-xs leading-5 text-[var(--text-muted)]">
                    Layout, images and styles stay as they are. Saving adds a
                    new version; earlier ones are kept.
                  </p>
                  <SubmitButton variant="secondary">
                    Save as new version
                  </SubmitButton>
                </ActionForm>
                <details className="mt-5 rounded-lg border border-[var(--line)] p-4">
                  <summary className="cursor-pointer text-sm">
                    Edit the HTML code · advanced
                  </summary>
                  <div className="mt-4">{rawForm}</div>
                </details>
              </>
            ) : owner && !deliveryActive ? (
              <>
                {revision.html !== null && (
                  <div className="mb-4">
                    <Notice>
                      This email has too much text to edit block by block. Edit
                      its HTML code below, or the plain-text version.
                    </Notice>
                  </div>
                )}
                {rawForm}
              </>
            ) : (
              <Notice>
                {deliveryActive
                  ? 'Delivery is in progress, so this email cannot be edited.'
                  : 'Only the workspace owner can edit this email.'}
              </Notice>
            )}
          </EditSection>
          <Panel
            title="Preview"
            description={originLabel[revision.origin] ?? undefined}
          >
            {revision.origin === 'sample_rewrite' && (
              <div className="mb-4">
                <Notice>
                  Sample mode: this text was not written by AI. Replace it
                  before using it.
                </Notice>
              </div>
            )}
            {(revision.checks as string[]).length > 0 && (
              <div className="mb-4 rounded-lg border border-[var(--line)] p-4 text-sm leading-6">
                <p className="font-medium">Worth checking</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--text-muted)]">
                  {(revision.checks as string[]).map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
              </div>
            )}
            {['ai_rewrite', 'sample_rewrite'].includes(revision.origin) && (
              <p className="mb-4 text-xs leading-5 text-[var(--text-muted)]">
                Automatic checks are not a fact check. Confirm claims before
                approving.
              </p>
            )}
            <EmailPreview
              title={`Email version ${revision.revision}`}
              html={revision.html}
              text={revision.body_text}
            />
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              {revision.html !== null && (
                <a
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                  href={download(result.id, 'html', revision.revision)}
                >
                  <Download className="size-4" aria-hidden /> Download HTML
                </a>
              )}
              <a
                className="inline-flex items-center gap-1 underline underline-offset-4"
                href={download(result.id, 'text', revision.revision)}
              >
                <Download className="size-4" aria-hidden /> Download text
              </a>
            </div>
          </Panel>
        </div>
      )}
      <div className="mx-auto mt-5 max-w-3xl space-y-3">
        {owner &&
          revision &&
          current &&
          !writing &&
          availability.ready &&
          !deliveryActive && (
            <ActionForm action={rewriteAgain}>
              <input type="hidden" name="resultId" value={result.id} />
              <input
                type="hidden"
                name="revision"
                value={result.current_revision}
              />
              <input type="hidden" name="attempt" value={randomUUID()} />
              <SubmitButton variant="quiet">
                {result.mode === 'copy'
                  ? 'Rewrite this for my brand'
                  : 'Rewrite again'}
              </SubmitButton>
            </ActionForm>
          )}
        <details className="rounded-lg border border-[var(--line)] px-4 py-3">
          <summary className="cursor-pointer text-sm">
            Versions ({revisions.length})
          </summary>
          <ol className="mt-3 space-y-2 text-sm">
            {revisions.map((r) => (
              <li
                key={r.revision}
                className="flex flex-wrap justify-between gap-2"
              >
                <Link
                  href={`/emails/${result.id}?version=${r.revision}` as Route}
                  className="underline underline-offset-4"
                  aria-current={
                    r.revision === revision?.revision ? 'page' : undefined
                  }
                >
                  Version {r.revision} · {originLabel[r.origin]}
                </Link>
                <time className="text-xs text-[var(--text-muted)]">
                  {new Intl.DateTimeFormat('en', {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  }).format(new Date(r.created_at))}
                </time>
              </li>
            ))}
          </ol>
        </details>
        <details className="rounded-lg border border-[var(--line)] px-4 py-3">
          <summary className="cursor-pointer text-sm">
            {file
              ? 'The email you added · from your uploaded file'
              : 'The email you added · kept exactly as pasted'}
          </summary>
          <div className="mt-4">
            <EmailPreview
              title="The email you added"
              html={html ? source.original : null}
              text={source.original}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            <a
              className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
              href={download(result.id, 'original')}
            >
              <Download className="size-4" aria-hidden />
              {file
                ? 'Download the email content (decoded)'
                : 'Download the original'}
            </a>
            {file && owner && (
              <a
                className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
                href={download(result.id, 'file')}
              >
                <Download className="size-4" aria-hidden /> Download original
                file (exact bytes)
              </a>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}

/** Latest version: editing stays closed until asked for. Older: shown plainly. */
function EditSection({
  current,
  revision,
  children
}: {
  current: boolean
  revision: number
  children: React.ReactNode
}) {
  if (!current) return <Panel title={`Version ${revision}`}>{children}</Panel>
  return (
    <details className="rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-5 sm:p-6">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-[var(--line-strong)] px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        Edit email
      </summary>
      <div className="mt-5">{children}</div>
    </details>
  )
}
