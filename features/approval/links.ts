import 'server-only'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

/**
 * Approval links in the weekly email (APR-002, VISION section 10): signed,
 * single-use, valid for 7 days. A link carries only ids, never the email's
 * content.
 *
 * Who may use one: the link names its recipient (`sub`, the owner it was
 * sent to). Holding the link is that owner's authority, like a sign-in
 * link, but only while it still holds: when the button is pressed, the
 * server re-checks from the workspace's membership (never from the claim)
 * that `sub` is still an active owner of `tenantId`, and when someone is
 * signed in, that it is the same person.
 *
 * When a link is used up: opening it (GET) only calls `verifyApprovalLink`
 * and shows a confirmation page, so a mail scanner that opens every link
 * neither approves nor uses it up. Pressing the page's button (POST) calls
 * `redeemApprovalLink`, whose store records the link id (a unique key) and
 * applies the action in one transaction; a second press finds the id
 * already there.
 *
 * What a link covers: exactly the emails it showed, at their revisions.
 * Approve all from the email approves only those pairs (APR-001
 * `approveAll(items, claims.items, …)`), so a redo that landed after the
 * email was sent is never approved from it.
 */
export const linkLifetimeDays = 7

const maxItems = 20
const maxTokenLength = 2_000

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w:.-]+$/)
const shown = z.tuple([id, z.number().int().min(0)])

const claimsSchema = z.discriminatedUnion('act', [
  z.strictObject({
    v: z.literal(1),
    tenant: id,
    sub: id,
    batch: id,
    act: z.literal('approve_all'),
    items: z.array(shown).min(1).max(maxItems),
    jti: z.uuid(),
    exp: z.number().int().positive()
  }),
  z.strictObject({
    v: z.literal(1),
    tenant: id,
    sub: id,
    batch: id,
    act: z.literal('change'),
    items: z.array(shown).length(1),
    jti: z.uuid(),
    exp: z.number().int().positive()
  })
])

export type LinkClaims = z.infer<typeof claimsSchema>
export type LinkAction = LinkClaims['act']

export type LinkRefusal =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'used'
  | 'not_owner'
  | 'other_user'
  | 'changed'

/** What the owner reads when a link no longer works. */
export const refusalWords: Record<LinkRefusal, string> = {
  malformed: "This link isn't complete. Open the app to see your week.",
  bad_signature: "This link isn't valid. Open the app to see your week.",
  expired: `This link has expired (links work for ${linkLifetimeDays} days). Open the app to approve your week.`,
  used: 'This link was already used. Open the app to see where your week stands.',
  not_owner:
    'This link was sent to someone who no longer approves for this workspace. Open the app to see your week.',
  other_user:
    'This link was sent to another person. Sign in as them, or open the app to see your week.',
  changed:
    'Your week changed since this email was sent. Open the app to see the latest version.'
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url')

const keys = (secrets: string | readonly string[]) => {
  const list = typeof secrets === 'string' ? [secrets] : [...secrets]
  if (!list.length || list.some((s) => s.length < 32))
    throw new Error('Approval link secrets must be at least 32 characters.')
  return list
}

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest()

/**
 * Signs a link with the first secret. Passing the previous secret second
 * keeps live links working while the secret is rotated.
 */
export function signApprovalLink(
  secrets: string | readonly string[],
  link: {
    tenantId: string
    /** The owner the email goes to. */
    recipientId: string
    batchId: string
    action: LinkAction
    /** The emails the link covers, as shown: `[campaignId, revision]`. */
    items: readonly { campaignId: string; revision: number }[]
  },
  now: Date
) {
  const [secret] = keys(secrets)
  const parsed = claimsSchema.safeParse({
    v: 1,
    tenant: link.tenantId,
    sub: link.recipientId,
    batch: link.batchId,
    act: link.action,
    items: link.items.map((i) => [i.campaignId, i.revision]),
    jti: randomUUID(),
    exp: Math.floor(now.getTime() / 1000) + linkLifetimeDays * 86_400
  })
  if (!parsed.success)
    throw new Error(
      link.action === 'change' && link.items.length !== 1
        ? 'A Change link covers exactly one email.'
        : 'This approval link has missing or invalid ids.'
    )
  const payload = b64(JSON.stringify(parsed.data))
  const token = `${payload}.${b64(sign(secret, payload))}`
  if (token.length > maxTokenLength)
    throw new Error('This approval link would be too long.')
  return {
    token,
    jti: parsed.data.jti,
    expiresAt: new Date(parsed.data.exp * 1000).toISOString()
  }
}

/** Checks a link without using it up: the confirmation page (GET). */
export function verifyApprovalLink(
  secrets: string | readonly string[],
  token: string,
  now: Date
): { ok: true; claims: LinkClaims } | { ok: false; reason: LinkRefusal } {
  const list = keys(secrets)
  if (typeof token !== 'string' || token.length > maxTokenLength)
    return { ok: false, reason: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return { ok: false, reason: 'malformed' }
  const [payload, signature] = parts
  const given = Buffer.from(signature, 'base64url')
  // Only the canonical spelling of a signature is accepted.
  if (given.toString('base64url') !== signature)
    return { ok: false, reason: 'bad_signature' }
  const signed = list.some((secret) => {
    const expected = sign(secret, payload)
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
  if (!signed) return { ok: false, reason: 'bad_signature' }
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const parsed = claimsSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'malformed' }
  if (parsed.data.exp * 1000 <= now.getTime())
    return { ok: false, reason: 'expired' }
  return { ok: true, claims: parsed.data }
}

/**
 * The store behind the button: one database command (one transaction)
 * that locks the workspace, re-checks from membership that `claims.sub`
 * is still an active owner of `claims.tenant`, records `claims.jti` once
 * (a unique key), and applies the action to exactly `claims.items`.
 * It answers 'used' when the id was already recorded, 'not_owner' when
 * the recipient no longer owns the workspace, and 'changed' when the
 * revisions moved (the command's PT409). Nothing is recorded unless the
 * action applies.
 */
export type ApprovalLinkStore = {
  redeem(claims: LinkClaims): Promise<'ok' | 'used' | 'not_owner' | 'changed'>
}

/** Uses a link once: the confirmation page's button (POST). */
export async function redeemApprovalLink(
  secrets: string | readonly string[],
  token: string,
  now: Date,
  store: ApprovalLinkStore,
  /** The signed-in user, if any; it must be the link's recipient. */
  sessionUserId: string | null
): Promise<
  { ok: true; claims: LinkClaims } | { ok: false; reason: LinkRefusal }
> {
  const checked = verifyApprovalLink(secrets, token, now)
  if (!checked.ok) return checked
  if (sessionUserId !== null && sessionUserId !== checked.claims.sub)
    return { ok: false, reason: 'other_user' }
  const outcome = await store.redeem(checked.claims)
  return outcome === 'ok' ? checked : { ok: false, reason: outcome }
}
