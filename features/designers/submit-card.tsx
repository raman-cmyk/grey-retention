import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { Card } from '@/components/ui/card'
import { Field, controlClass } from '@/components/ui/workspace'
import { submitDesign } from './actions'
import { canSubmit, closedReason } from './model'

/**
 * The upload form, shown only on the designer's turn with a current brief;
 * otherwise one sentence says why it is closed.
 */
export function SubmitDesignCard({
  assignmentId,
  designRevision,
  state,
  stale
}: {
  assignmentId: string
  designRevision: number
  state: string
  stale: boolean
}) {
  return (
    <Card title="Submit a design">
      {canSubmit(state, stale) ? (
        <ActionForm action={submitDesign} className="grid gap-4">
          <input name="assignment" type="hidden" value={assignmentId} />
          <input name="revision" type="hidden" value={designRevision} />
          {state === 'revisions_requested' && (
            <p className="text-sm">
              Read the owner feedback below, then upload the new version.
            </p>
          )}
          <Field label="Design image">
            <input
              type="file"
              name="design"
              accept="image/png,image/jpeg,image/webp"
              required
              className={controlClass}
            />
          </Field>
          <p className="text-xs leading-5 text-[var(--text-muted)]">
            PNG, JPEG or WebP, up to 10 MB. It stays private: only you and this
            brand&apos;s team can see it.
          </p>
          <Field label="Submission notes">
            <textarea
              name="notes"
              className={controlClass}
              rows={4}
              maxLength={5000}
            />
          </Field>
          <div>
            <SubmitButton>Submit design version</SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <p className="text-sm leading-6 text-[var(--text-muted)]">
          {closedReason(state, stale)}
        </p>
      )}
    </Card>
  )
}
