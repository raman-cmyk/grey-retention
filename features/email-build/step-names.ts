/** "Create email"'s build steps in order (REL-081); the push follows. */
export const buildSteps = ['sections', 'content', 'copy', 'design'] as const
export type BuildStep = (typeof buildSteps)[number]

/** Every step a build can be at, as `email_builds.step` stores it. */
export const allSteps = [...buildSteps, 'push'] as const

/**
 * REL-AI part 2b: the steps whose agents make several model calls. Such a
 * step runs only what fits in one claim's time, saves its rounds
 * (`save_email_round`) and goes on from them in the next claim.
 */
export const roundSteps = ['copy', 'design'] as const
export type RoundStep = (typeof roundSteps)[number]

/**
 * A step saves at most this many times: `save_email_round` refuses more
 * (its own 16, in migration `email_step_rounds`; change both together).
 */
export const maxStepSaves = 16
