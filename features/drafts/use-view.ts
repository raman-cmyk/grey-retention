import type { DraftReference, ImportedDraftReference } from './sources'
import type { UseDesignView } from './use-screen'

/**
 * What "Use this design" shows (UI-OLDc), from the first-draft read and
 * the address's `reference` or `imported` id: the form with the chosen
 * email, the form from scratch when none is chosen, "This email is gone"
 * for an id the workspace does not have, the owner-only card for staff,
 * or the error when the read failed.
 */
export function draftStartView(
  input: {
    owner: boolean
    readable: boolean
    references: DraftReference[]
    imported: ImportedDraftReference[]
    requestKey: string
    brandName: string
    defaultDate: string
    timezone: string
    audiences: { id: string; label: string }[]
  },
  chosen: { reference?: string; imported?: string }
): UseDesignView {
  if (!input.readable) return { kind: 'error' }
  if (!input.owner) return { kind: 'staff' }
  // An email the owner added wins over a competitor email, as before.
  const imported = chosen.imported
    ? (input.imported.find((i) => i.id === chosen.imported) ?? null)
    : null
  const reference =
    !chosen.imported && chosen.reference
      ? (input.references.find((r) => r.id === chosen.reference) ?? null)
      : null
  if (chosen.imported ? !imported : chosen.reference ? !reference : false)
    return { kind: 'missing' }
  return {
    kind: 'form',
    reference,
    imported,
    requestKey: input.requestKey,
    defaultTitle: `${input.brandName} · new email`.slice(0, 200),
    defaultDate: input.defaultDate,
    timezone: input.timezone,
    audiences: input.audiences
  }
}
