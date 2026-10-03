import type { RequestContext } from '@/features/auth/domain/types'
import type {
  ConversationAccess,
  FailureClass,
  MaterialEdit,
  RevisionSet
} from './contracts'

export type Capability =
  | 'read'
  | 'edit_draft'
  | 'approve'
  | 'schedule'
  | 'assign'
  | 'diagnose'
  | 'configure'
  | 'chat'
export function can(
  context: RequestContext,
  capability: Capability,
  tenantId?: string
) {
  if (context.kind === 'client') {
    if (context.tenantId !== tenantId) return false
    if (['read', 'edit_draft', 'chat'].includes(capability)) return true
    return (
      context.tenantRole === 'owner' &&
      ['approve', 'schedule'].includes(capability)
    )
  }
  if (context.kind === 'admin')
    return (
      ['assign', 'diagnose'].includes(capability) ||
      (capability === 'configure' && context.adminRole === 'super_admin')
    )
  return false // Assignment access is a separate resource policy, never tenant-wide.
}
export function canReadConversation(
  context: RequestContext,
  conversation: ConversationAccess
) {
  return (
    can(context, 'chat', conversation.tenantId) &&
    (conversation.visibility === 'shared' ||
      conversation.creatorId === context.userId)
  )
}
export function canConfirmProposal(
  context: RequestContext,
  conversation: ConversationAccess,
  actorId: string,
  targetRevision: number,
  currentRevision: number,
  expiresAt: string,
  now: string
) {
  return (
    canReadConversation(context, conversation) &&
    actorId === context.userId &&
    targetRevision === currentRevision &&
    Date.parse(now) < Date.parse(expiresAt)
  )
}
export const invalidationMatrix: Record<MaterialEdit, (keyof RevisionSet)[]> = {
  brief: ['calendar', 'copy', 'design', 'delivery'],
  copy: ['copy', 'design', 'delivery'],
  design: ['design', 'delivery'],
  audience: ['calendar', 'delivery'],
  schedule: ['calendar', 'delivery'],
  sender: ['delivery'],
  links: ['design', 'delivery'],
  footer: ['design', 'delivery']
}
export function revise(current: RevisionSet, edit: MaterialEdit): RevisionSet {
  const next = { ...current }
  for (const key of invalidationMatrix[edit]) next[key] += 1
  return next
}
export function retryDecision(
  failure: FailureClass,
  attempts: number,
  reconciliation?: 'found' | 'absent' | 'unknown'
) {
  if (failure === 'unknown_outcome')
    return reconciliation === 'found'
      ? 'resume_existing'
      : reconciliation === 'absent' && attempts < 4
        ? 'retry'
        : 'reconcile'
  return ['transient', 'rate_limit'].includes(failure) && attempts < 4
    ? 'retry'
    : 'stop'
}
export const developmentPolicy = Object.freeze({
  weeklyAudienceCap: 5,
  discountCapPercent: 40,
  sitewideSpacingDays: 7,
  minimumAssets: 20,
  minimumCompetitors: 3,
  emailsPerCompetitor: 10,
  learningSamplesPerSide: 5,
  l2ConsecutiveSends: 10,
  silenceHours: 72,
  maxDeliveryAttempts: 4,
  productionL2: false,
  designDelegation: false,
  liveSuppression: false,
  crossClientTemplates: false,
  sms: false
})
