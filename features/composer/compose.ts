/**
 * Composer modes (docs/DESIGN.md → The composer). Each available mode maps to
 * an existing outcome on the "What should we make?" page; nothing is created
 * or rewritten until the owner confirms there.
 */
export const composerModes = [
  {
    value: 'exact',
    label: 'Exact',
    outcome: 'copy',
    description:
      'Keeps the email as it is, so you can edit an exact copy. Nothing is rewritten.'
  },
  {
    value: 'rebrand',
    label: 'Rebrand',
    outcome: 'rewrite',
    description:
      'Keeps the layout and rewrites the words for your brand, using your brand details.'
  },
  {
    value: 'adapt',
    label: 'Adapt',
    outcome: null,
    description: 'Keeps the strategy and writes new content.',
    disabledReason: 'Coming soon'
  }
] as const

export type ComposerMode = (typeof composerModes)[number]['value']
export type ComposerOutcome = 'copy' | 'rewrite'

export function outcomeFor(mode: string): ComposerOutcome | null {
  const match = composerModes.find((item) => item.value === mode)
  return match?.outcome ?? null
}

/** True when the box holds only a web link, which we cannot read yet. */
export function isLinkOnly(value: string) {
  return /^(https?:\/\/|www\.)\S+$/i.test(value.trim())
}
