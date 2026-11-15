/** "Create email"'s build steps in order (REL-081); the push follows. */
export const buildSteps = ['sections', 'content', 'copy', 'design'] as const
export type BuildStep = (typeof buildSteps)[number]

/** Every step a build can be at, as `email_builds.step` stores it. */
export const allSteps = [...buildSteps, 'push'] as const
