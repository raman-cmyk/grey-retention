import 'server-only'
import { randomUUID } from 'node:crypto'
import { draftDefaultDate } from './default-date'
import { campaignWorkspace } from '@/features/campaigns/data'
import {
  pastedReference,
  pastedReferences
} from '@/features/references/pasted-data'

/**
 * The draft form's reads (UI-OLDc): the workspace, its emails it added and
 * the one chosen. UI-USE: a followed brand's email runs Create email on a
 * planned email instead, so the form reads no competitor emails.
 */
export async function firstDraftWorkspace(
  selectedImport?: string,
  /** A day picked on the Campaigns calendar (`?date=YYYY-MM-DD`). */
  plannedDay?: string
) {
  const workspace = await campaignWorkspace()
  const tenantId = workspace.context.tenantId
  const [imports, chosenImport] = await Promise.all([
    pastedReferences(tenantId, 12),
    selectedImport ? pastedReference(tenantId, selectedImport) : null
  ])
  const chosen = chosenImport?.data
  return {
    ...workspace,
    requestKey: randomUUID(),
    defaultDate: draftDefaultDate(plannedDay, workspace.context.timezone),
    imported: chosen
      ? [chosen, ...imports.data.filter((item) => item.id !== chosen.id)]
      : imports.data,
    importError: imports.error ?? chosenImport?.error ?? null
  }
}
