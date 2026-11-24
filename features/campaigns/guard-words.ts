/**
 * The approval guards' known refusals (`assert_campaign_guards`, which
 * `approve_calendar` and `approve_copy` run) in the owner's words (UI-OLDc);
 * the reason stays the real one. Any other refusal is shown as the command
 * says it.
 */
const guardWords: [RegExp, string][] = [
  [
    /^Future date and authorized audience with exclusions required/,
    'Choose an audience and a future send time first.'
  ],
  [/^Approve current brand context/, 'Approve your brand first.'],
  [/^Superseded plan entry/, 'A newer plan replaced this draft.']
]

export function plainGuard(message?: string) {
  if (!message) return undefined
  return guardWords.find(([pattern]) => pattern.test(message))?.[1] ?? message
}
