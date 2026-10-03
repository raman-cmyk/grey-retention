import { z } from 'zod'
import type { JobStatus } from '@/lib/jobs/contracts'

export const approvalStates = ['proposed', 'approved', 'rejected'] as const
export const designStates = [
  'unassigned',
  'assigned',
  'submitted',
  'revisions_requested',
  'owner_approved'
] as const
export const deliveryStates = [
  'not_ready',
  'ready',
  'queued',
  'preparing',
  'prepared',
  'scheduling',
  'scheduled',
  'sent',
  'reconciling',
  'blocked',
  'cancelled',
  'failed'
] as const
export type ApprovalState = (typeof approvalStates)[number]
export type DesignState = (typeof designStates)[number]
export type DeliveryState = (typeof deliveryStates)[number]
export type RevisionSet = {
  calendar: number
  copy: number
  design: number
  delivery: number
}
export type Approval = {
  id: string
  actorId: string
  revision: number
  kind: keyof RevisionSet
  recordedAt: string
}
export type MaterialEdit =
  | 'brief'
  | 'copy'
  | 'design'
  | 'audience'
  | 'schedule'
  | 'sender'
  | 'links'
  | 'footer'
export type ConversationAccess = {
  tenantId: string
  creatorId: string
  visibility: 'private' | 'shared'
}
export type BrandFacts = {
  revision: number
  approvedRevision: number | null
  facts: Record<string, string>
  corrections: Record<string, string>
  prohibitions: string[]
}
export type PermittedOffer = {
  id: string
  revision: number
  kind: 'evergreen' | 'discount' | 'sitewide'
  depthPercent: number
  startsAt: string
  endsAt: string
  conditions: string
  approved: boolean
}
export type CampaignLineage = {
  brandRevision: number
  offerRevision: number | null
  productIds: string[]
  evidenceIds: string[]
  ruleIds: string[]
  sequenceId: string | null
  sequencePosition: number | null
}
export type DesignSubmission = {
  id: string
  assignmentId: string | null
  revision: number
  copyRevision: number
  artifactPath: string
  assetIds: string[]
  path: 'human' | 'fixture'
  submittedBy: string
}
export type SectionFeedback = {
  submissionId: string
  section: string
  feedback: string
  actorId: string
  createdAt: string
}
export const httpsUrl = z
  .url()
  .refine((url) => new URL(url).protocol === 'https:', 'Use an HTTPS URL')
export const deliveryPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    tenantId: z.uuid(),
    campaignId: z.uuid(),
    revision: z.number().int().positive(),
    channel: z.enum(['email_design', 'email_text']),
    subject: z.string().min(1).max(200),
    preheader: z.string().max(300),
    text: z.string().min(1),
    html: z.string().min(1),
    assetPaths: z.array(z.string().min(1)),
    links: z.array(httpsUrl).min(1),
    footer: z.object({
      address: z.string().min(5),
      unsubscribeUrl: httpsUrl,
      privacyUrl: httpsUrl
    }),
    audience: z.object({
      accountId: z.string().min(1),
      includes: z.array(z.string().min(1)).min(1),
      excludes: z.array(z.string().min(1)).min(1)
    }),
    sender: z.object({ name: z.string().min(1), email: z.email() }),
    scheduledAt: z.iso.datetime(),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v })
        return true
      } catch {
        return false
      }
    }, 'Invalid timezone'),
    approvals: z.object({
      calendar: z.uuid(),
      copy: z.uuid(),
      design: z.uuid()
    }),
    sourceRevisions: z.object({
      calendar: z.number().int().positive(),
      copy: z.number().int().positive(),
      design: z.number().int().positive()
    }),
    createdAt: z.iso.datetime(),
    synthetic: z.boolean()
  })
  .strict()
export type DeliveryPackage = z.infer<typeof deliveryPackageSchema>
export type DeliveryIdentity = {
  id: string
  packageId: string
  state: 'prepared' | 'scheduled' | 'sent' | 'cancelled'
  scheduledAt: string | null
}
export type Reconciliation =
  | { outcome: 'found'; identity: DeliveryIdentity }
  | { outcome: 'absent' | 'unknown' }
export type CampaignResults = {
  deliveryId: string
  window: '48h' | '7d'
  source: 'fixture' | 'provider'
  collectedAt: string
  complete: boolean
  comparable: boolean
  windowStart: string
  windowEnd: string
  currency: 'USD'
  confounders: string[]
  recipients: number
  clicks: number
  revenueMinor: number
  unsubscribes: number
  spam: number
}
export interface DeliveryProvider {
  prepare(
    input: Readonly<DeliveryPackage>,
    idempotencyKey: string
  ): Promise<DeliveryIdentity>
  schedule(
    identity: DeliveryIdentity,
    scheduledAt: string
  ): Promise<DeliveryIdentity>
  state(id: string): Promise<DeliveryIdentity>
  reschedule(
    id: string,
    scheduledAt: string,
    idempotencyKey: string
  ): Promise<DeliveryIdentity>
  cancel(id: string, idempotencyKey: string): Promise<DeliveryIdentity>
  reconcile(idempotencyKey: string): Promise<Reconciliation>
  results(id: string, window: '48h' | '7d'): Promise<CampaignResults>
}
export type CanonicalSegment = {
  key: 'engaged' | 'purchasers' | 'suppressed'
  accountId: string
  providerId: string
  fixtureDefinition: string
}
export type DurableJob = {
  id: string
  tenantId: string
  kind: string
  idempotencyKey: string
  status: JobStatus
  attempt: number
  maxAttempts: 4
  leaseToken: string | null
  leaseUntil: string | null
  checkpoint: Record<string, unknown>
  availableAt: string
}
export type FailureClass =
  'transient' | 'rate_limit' | 'unknown_outcome' | 'auth' | 'validation'
export interface UsagePort {
  reserve(
    tenantId: string,
    operationId: string,
    feature: string,
    estimatedMicroUsd: number
  ): Promise<{ reservationId: string; softAlert: boolean }>
  reconcile(reservationId: string, actualMicroUsd: number): Promise<void>
}
export interface AssetClassifier {
  classify(path: string): Promise<{
    category: 'product' | 'lifestyle' | 'proof' | 'logo' | 'unusable'
    productId: string | null
    synthetic: boolean
  }>
}
export interface CatalogMatcher {
  match(
    assetId: string,
    tenantId: string
  ): Promise<{
    productId: string | null
    variantId: string | null
    confidence: number
    synthetic: boolean
  }>
}
export interface CapturePort {
  capture(
    domain: string,
    cursor: string | null
  ): Promise<{
    records: {
      externalId: string
      receivedAt: string
      html: string
      subject: string
    }[]
    nextCursor: string | null
    synthetic: boolean
  }>
}
export interface ExtractionPort {
  extract(captureId: string): Promise<{
    offerCode: string | null
    product: string | null
    theme: string
    strips: string[]
    synthetic: boolean
  }>
}
export interface PlaybookPort {
  synthesize(
    tenantId: string,
    evidenceIds: string[]
  ): Promise<{ patterns: string[]; evidenceIds: string[]; synthetic: boolean }>
}
export interface DrivePort {
  list(
    folderId: string,
    cursor: string | null
  ): Promise<{
    files: { id: string; name: string; mediaType: string; size: number }[]
    cursor: string | null
  }>
}
export interface CommercePort {
  products(cursor: string | null): Promise<{
    products: {
      externalId: string
      title: string
      url: string
      stock: number
      observedAt: string
    }[]
    cursor: string | null
    synthetic: boolean
  }>
}
export interface NotificationPort {
  deliver(input: {
    tenantId: string
    recipientId: string
    template: string
    idempotencyKey: string
  }): Promise<{ reference: string; simulated: boolean }>
}
export interface RendererPort {
  render(input: {
    copyRevision: number
    text: string
    assetPaths: string[]
    structure: string[]
  }): Promise<{
    html: string
    strips: { section: string; artifactPath: string; copyRevision: number }[]
    synthetic: boolean
  }>
}
export type StructuredAiOutput<T> = {
  schemaVersion: 1
  promptVersion: string
  inputRevisions: Record<string, number>
  synthetic: boolean
  value: T
}
