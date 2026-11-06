import 'server-only'
import { randomUUID } from 'node:crypto'
import { futureIso } from '@/lib/time'
import { localDateTime } from '@/lib/local-time'
import { campaignWorkspace } from '@/features/campaigns/data'
import { referenceWorkspace } from '@/features/references/data'
import {
  pastedReference,
  pastedReferences
} from '@/features/references/pasted-data'

export async function firstDraftWorkspace(
  selectedReference?: string,
  selectedImport?: string
) {
  const [workspace, references] = await Promise.all([
    campaignWorkspace(),
    referenceWorkspace()
  ])
  const tenantId = workspace.context.tenantId
  const [imports, chosenImport] = await Promise.all([
    pastedReferences(tenantId, 12),
    selectedImport ? pastedReference(tenantId, selectedImport) : null
  ])
  const emails = references.data?.emails ?? []
  const selected = emails.find((email) => email.id === selectedReference)
  const chosen = chosenImport?.data
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
    imported: chosen
      ? [chosen, ...imports.data.filter((item) => item.id !== chosen.id)]
      : imports.data,
    referenceError: references.error,
    importError: imports.error ?? chosenImport?.error ?? null
  }
}
