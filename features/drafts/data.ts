import 'server-only'
import { randomUUID } from 'node:crypto'
import { futureIso } from '@/lib/time'
import { localDateTime } from '@/lib/local-time'
import { campaignWorkspace } from '@/features/campaigns/data'
import { referenceWorkspace } from '@/features/references/data'

export async function firstDraftWorkspace(selectedReference?: string) {
  const [workspace, references] = await Promise.all([
    campaignWorkspace(),
    referenceWorkspace()
  ])
  const emails = references.data?.emails ?? []
  const selected = emails.find((email) => email.id === selectedReference)
  return {
    ...workspace,
    requestKey: randomUUID(),
    defaultDate: localDateTime(futureIso(7), workspace.context.timezone),
    references: selected
      ? [
          selected,
          ...emails.filter((email) => email.id !== selected.id).slice(0, 11)
        ]
      : emails.slice(0, 12),
    referenceError: references.error
  }
}
