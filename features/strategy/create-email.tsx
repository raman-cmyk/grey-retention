import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { createEmail } from '@/features/email-build/actions'

/** "Create email" on one planned email: the owner's click (D17). */
export function CreateEmailButton({
  run,
  slot,
  label
}: {
  run: string
  slot: number
  label: string
}) {
  return (
    <ActionForm action={createEmail}>
      <input type="hidden" name="run" value={run} />
      <input type="hidden" name="slot" value={slot} />
      <SubmitButton pendingLabel="Creating…">{label}</SubmitButton>
    </ActionForm>
  )
}
