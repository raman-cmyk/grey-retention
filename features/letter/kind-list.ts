/**
 * DST-PIC #24: the kinds of text email, by name only, for the planner and
 * the plan's readers (the rules and checks are in `./kinds`).
 */
export const letterKinds = [
  'founder_note',
  'quick_question',
  'we_miss_you',
  'launch_teaser',
  'thank_you'
] as const
export type LetterKind = (typeof letterKinds)[number]
/** The kinds that never carry an offer. */
export const kindsWithoutOffer: readonly LetterKind[] = [
  'quick_question',
  'launch_teaser'
]
/** When each kind is the right letter, for the planner. */
export const kindWhen: Record<LetterKind, string> = {
  founder_note:
    'The founder writes to a customer they know, around the founder’s own note.',
  quick_question:
    'One simple question for the reader to answer by reply; no offer.',
  we_miss_you: 'For people who have not shopped or opened in a while.',
  launch_teaser:
    'Something new from the store, before the email that shows it; no offer.',
  thank_you: 'Thanks the reader for being a customer or for reading along.'
}
