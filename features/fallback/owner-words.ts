/**
 * REL-084b: the fallback log in the owner's words (D16), before a screen
 * shows it. Each line names the part of the team that gave up in words
 * the owner knows (never an agent key such as `content-locker`), and the
 * AI's own failures (it could not answer, kept answering in a shape we
 * could not use, or its answers kept failing our checks) are said plainly
 * by their reason code. Every other reason is fixed words per rule
 * (`fallbackEntry`), so it is kept. No name here may sound like a person:
 * the product has human designers and a Team page.
 */

/** Who gave up, as the owner would say it. */
export const teamNames = {
  // Planning the next 15 days.
  'brand-pulse': 'The store check',
  'competitor-mapper': 'The competitor check',
  'brief-writer': 'The plan writer',
  'calendar-planner': 'The plan writer',
  'calendar-rules': 'The calendar rules',
  'strategy-critic': 'The plan check',
  'plan-offers': 'Checking your offers',
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
  'designer-a': 'The email layout',
  'designer-b': 'The hero picture',
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
  'email-classifier': 'Reading inspiration emails',
  'email-inspector': 'The email check',
  'variant-maker': 'Making block variations'
} as const satisfies Record<string, string>

/** Who gave up when the agent is not named above: never a person. */
export const unnamed = 'The app'

/**
 * Where `tryAgent`'s own codes (`failedWords`) end up: bare, or after the
 * prefix each caller gives them (`content_`, `brief_`, …). Only these are
 * the AI's failures; a check of rules (`copy_check_failed`) keeps its words.
 */
const aiPrefixes = [
  '',
  'brief_',
  'planner_',
  'critic_',
  'email_critic_',
  'content_',
  'sections_',
  'section_',
  'inspector_',
  'visual_',
  'pulse_',
  'mapper_',
  'storyboard_'
]
const aiWords = {
  agent_failed:
    'The AI could not answer this time (it may have been unavailable, or the AI allowance is used up).',
  answer_invalid: 'The AI kept giving answers we could not use.',
  check_failed: 'The AI’s answers kept failing our checks.'
} as const

/** The AI's own failure a reason code names, or null. */
function aiFailure(code: string) {
  for (const [kind, words] of Object.entries(aiWords))
    if (aiPrefixes.some((p) => code === `${p}${kind}`)) return words
  return null
}

export type OwnerLine = {
  /** Who gave up, in the owner's words. */
  who: string
  /** What went wrong, in the owner's words. */
  what: string
  /** What the team did instead, as stored (fixed words; some still the team's own). */
  instead: string
}

/** One log line in the owner's words; an agent not named here is `unnamed`. */
export function ownerLine(entry: {
  agent: string
  reasonCode: string
  reason: string
  fallback: string
}): OwnerLine {
  return {
    who: Object.hasOwn(teamNames, entry.agent)
      ? teamNames[entry.agent as keyof typeof teamNames]
      : unnamed,
    what: aiFailure(entry.reasonCode) ?? entry.reason,
    instead: entry.fallback
  }
}
