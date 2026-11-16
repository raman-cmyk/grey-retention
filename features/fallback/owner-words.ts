/**
 * REL-084b: the fallback log in the owner's words (D16), before a screen
 * shows it. Each line names the part of the team that gave up in words
 * the owner knows (never an agent key such as `content-locker`), and the
 * AI's own failures (it could not answer, or kept answering in a shape we
 * could not use) are said plainly by their reason code. Every other reason
 * is already fixed plain words per rule (`fallbackEntry`), so it is kept.
 */

/** Who gave up, as the owner would say it. */
export const teamNames: Record<string, string> = {
  // Planning the next 15 days.
  'brand-pulse': 'The store check',
  'competitor-mapper': 'The competitor check',
  'brief-writer': 'The plan writer',
  'calendar-planner': 'The plan writer',
  'calendar-rules': 'The calendar rules',
  'strategy-critic': 'The plan check',
  'plan-offers': 'Your offers',
  'plan-dates': 'The plan’s dates',
  // Creating an email.
  'email-build': 'Creating the email',
  'section-planner': 'The email planner',
  'content-locker': 'Choosing the email’s content',
  copywriter: 'The copywriter',
  'copy-check': 'The copy check',
  'copy-inspectors': 'The copy check',
  'brand-inspector': 'The brand check',
  'visual-inspector': 'The design check',
  assembly: 'Putting the email together',
  'designer-a': 'The email designer',
  'designer-b': 'The email designer',
  'design-studio': 'The design studio',
  'art-director': 'The design studio',
  'section-designer': 'The design studio',
  'design-critic': 'The design studio',
  'email-checks': 'The email checks',
  'ab-test': 'The A/B test',
  // Understanding the brand and the inspiration inbox.
  'site-reader': 'Reading your website',
  'reviews-reader': 'Reading your reviews',
  'ads-analyst': 'Reading your ads',
  'catalog-analyst': 'Reading your products',
  'klaviyo-historian': 'Reading your Klaviyo history',
  'section-tagger': 'Reading inspiration emails',
  section_tagger: 'Reading inspiration emails',
  'email-classifier': 'Reading inspiration emails',
  'email-inspector': 'Reading inspiration emails',
  'variant-maker': 'Making block variations'
}

/** The AI's own failures, by the end of their reason code (`failedWords`). */
const aiFailures: [RegExp, string][] = [
  [
    /(^|_)agent_failed$/,
    'The AI could not answer: it was unavailable, or this month’s AI allowance is used up.'
  ],
  [/(^|_)answer_invalid$/, 'The AI kept giving answers we could not use.']
]

export type OwnerLine = {
  /** Who gave up, in the owner's words. */
  who: string
  /** What went wrong, in the owner's words. */
  what: string
  /** What the team did instead (already the owner's words). */
  instead: string
}

/** One log line in the owner's words; an agent not named here is "The team". */
export function ownerLine(entry: {
  agent: string
  reasonCode: string
  reason: string
  fallback: string
}): OwnerLine {
  const ai = aiFailures.find(([code]) => code.test(entry.reasonCode))
  return {
    who: Object.hasOwn(teamNames, entry.agent)
      ? teamNames[entry.agent]!
      : 'The team',
    what: ai ? ai[1] : entry.reason,
    instead: entry.fallback
  }
}
