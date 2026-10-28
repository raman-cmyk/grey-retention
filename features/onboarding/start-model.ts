export type StartStep = 'brand' | 'reference' | 'draft'

// Progress comes from saved records, never a browser-only completion flag.
export function startProgress(input: {
  hasBrand: boolean
  hasEmails: boolean
  hasCampaign: boolean
}) {
  const steps = [
    { id: 'brand', label: 'Your brand', complete: input.hasBrand },
    { id: 'reference', label: 'Add an email', complete: input.hasEmails },
    { id: 'draft', label: 'Your email', complete: input.hasCampaign }
  ] as const
  return {
    steps,
    current: steps.find((step) => !step.complete)?.id ?? 'draft',
    complete: steps.every((step) => step.complete)
  }
}
