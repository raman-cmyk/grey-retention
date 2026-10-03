import { developmentPolicy } from '@/features/workflow/domain/policy'
export type ReadinessInput = {
  connected: boolean
  approvedProfile: boolean
  whitelistSaved: boolean
  classifiedAssets: number
  competitors: { status: string; emails: number }[]
}
export function readiness(input: ReadinessInput) {
  const p = developmentPolicy
  const gates = [
    {
      name: 'Klaviyo fixture connection',
      met: input.connected,
      detail: input.connected
        ? 'Fixture connected'
        : 'Connect a fixture account; no live account is contacted'
    },
    {
      name: 'Owner-approved brand profile',
      met: input.approvedProfile,
      detail: input.approvedProfile
        ? 'Current version approved'
        : 'Correct and approve the current version'
    },
    {
      name: 'Saved permitted offers',
      met: input.whitelistSaved,
      detail: input.whitelistSaved
        ? 'Current offer whitelist saved'
        : 'Save an explicit evergreen or dated permitted offer'
    },
    {
      name: 'Classified usable assets',
      met: input.classifiedAssets >= p.minimumAssets,
      detail: `${input.classifiedAssets}/${p.minimumAssets}; fixture classifications are synthetic`
    },
    {
      name: 'LIVE competitor evidence',
      met:
        input.competitors.filter(
          (c) => c.status === 'live' && c.emails >= p.emailsPerCompetitor
        ).length >= p.minimumCompetitors,
      detail: `${input.competitors.filter((c) => c.status === 'live' && c.emails >= p.emailsPerCompetitor).length}/${p.minimumCompetitors} competitors with ${p.emailsPerCompetitor} emails each`
    }
  ]
  return { ready: gates.every((g) => g.met), gates }
}
