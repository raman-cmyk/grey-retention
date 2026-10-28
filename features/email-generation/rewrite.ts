import { createHash } from 'node:crypto'
import {
  AiProviderError,
  type AiProviderRequest
} from '@/lib/providers/contracts'
import {
  htmlSegments,
  htmlToText,
  rewriteHtml,
  type EmailFormat,
  type Segment
} from './html'
import {
  rewriteInstructions,
  rewriteJsonSchema,
  rewriteOutputSchema,
  rewriteUserPayload,
  type BrandFacts
} from './prompt'

export type RewriteContext = {
  brand: BrandFacts
  allowedLinks: string[]
  ownerNote: string
  subject: string
  format: EmailFormat
  original: string
  /** Domains seen in the source; used only to warn about leftover mentions. */
  sourceHosts: string[]
}

export type RewriteResult = {
  subject: string
  subjectOptions: string[]
  preheader: string
  body: string
  cta: string
  url: string
  html: string | null
  checks: string[]
  reviewNotes: string[]
}

/** Normalizes a saved website ("store.com", "https://store.com/") to HTTPS. */
export function httpsLink(value: string | null | undefined) {
  const raw = (value ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
    )
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !url.hostname.includes('.')
    )
      return null
    return url.href.length <= 2000 ? url.href : null
  } catch {
    return null
  }
}

const genericLabels = new Set([
  'mail',
  'email',
  'click',
  'links',
  'track',
  'tracking',
  'klaviyo',
  'list-manage',
  'mailchimp',
  'shopify',
  'cdn',
  'static',
  'images',
  'example'
])

/** Brand-like labels of web addresses in the source (warnings only). */
export function sourceHosts(original: string, sourceUrl: string | null) {
  const hosts = new Set<string>()
  const candidates = [...original.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(
    (m) => m[1]
  )
  if (sourceUrl)
    candidates.push(sourceUrl.replace(/^https?:\/\//i, '').split(/[/?#:]/)[0])
  for (const host of candidates.slice(0, 500)) {
    const labels = host.toLowerCase().split('.').filter(Boolean)
    const label = labels.length >= 2 ? labels[labels.length - 2] : labels[0]
    if (label && label.length >= 4 && !genericLabels.has(label))
      hosts.add(label)
  }
  return [...hosts].slice(0, 20)
}

/** Identifies the exact stored HTML an edit form was built from. */
export function htmlFingerprint(html: string) {
  return createHash('sha256').update(html).digest('hex')
}

export function safetyIdentifier(tenantId: string, userId: string) {
  return createHash('sha256').update(`${tenantId}:${userId}`).digest('hex')
}

export function prepareRewrite(
  context: RewriteContext,
  options: { model: string; timeoutMs: number; safetyIdentifier: string }
) {
  if (!context.allowedLinks.length)
    throw new AiProviderError('rejected_request', 'none', {
      diagnostic: 'no_destination'
    })
  const html = context.format === 'html'
  const segments = html ? htmlSegments(context.original) : null
  const sourceText = html
    ? htmlToText(context.original)
    : context.original.replace(/\r\n?/g, '\n')
  const request: AiProviderRequest = {
    system: rewriteInstructions,
    user: rewriteUserPayload({
      brand: context.brand,
      allowedLinks: context.allowedLinks,
      ownerNote: context.ownerNote,
      subject: context.subject,
      sourceText,
      segments
    }),
    model: options.model,
    maxOutputTokens: segments ? 8_000 : 4_000,
    temperature: 0.7,
    responseKind: 'json',
    schema: {
      name: 'email_rewrite',
      definition: rewriteJsonSchema(context.allowedLinks)
    },
    reasoningEffort: 'low',
    timeoutMs: options.timeoutMs,
    safetyIdentifier: options.safetyIdentifier
  }
  return { request, segments }
}

/** Short owner-facing warnings; approval guards remain authoritative. */
export function factChecks(text: string, context: RewriteContext) {
  const checks: string[] = []
  const lower = text.toLowerCase()
  const depth = context.brand.offer?.depthPercent ?? 0
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g))
    if (Number(match[1]) !== depth) {
      checks.push(
        `Mentions ${match[0].trim()}, which is not one of your saved offers.`
      )
      break
    }
  if (
    /[$£€¥]\s?\d|\d\s?(usd|eur|gbp)\b/i.test(text) &&
    !context.brand.product?.price
  )
    checks.push('Mentions a price. Check it against your store.')
  if (
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/i.test(
      text
    )
  )
    checks.push('Mentions a date. Check that it is right.')
  if (
    /\b(ends? (tonight|today|soon|at midnight)|last chance|today only|only \d+ left|hours? left|while (it|they) lasts?)\b/i.test(
      text
    )
  )
    checks.push('Uses urgency wording. Make sure it is true.')
  if (/https?:\/\/|www\./i.test(text))
    checks.push('Contains a web address in the text.')
  const rules = context.brand.rules
    .split(/[\n,;]+/)
    .map((rule) =>
      rule
        .replace(/^(no|avoid|never|don['’]?t (say|use))\s+/i, '')
        .trim()
        .toLowerCase()
    )
    .filter((rule) => rule.length >= 3)
  for (const rule of rules)
    if (lower.includes(rule))
      checks.push(`Contains “${rule}”, which your brand rules avoid.`)
  const own = `${context.brand.name} ${context.brand.website}`.toLowerCase()
  for (const label of context.sourceHosts)
    if (
      !own.includes(label) &&
      new RegExp(`\\b${label.replace(/[^a-z0-9-]/g, '')}\\b`, 'i').test(text)
    )
      checks.push(`Mentions “${label}”, which appears in the pasted email.`)
  return [...new Set(checks)].slice(0, 8)
}

export function interpretRewrite(
  content: unknown,
  context: RewriteContext,
  segments: Segment[] | null
): RewriteResult {
  const parsed = rewriteOutputSchema(context.allowedLinks, segments).safeParse(
    content
  )
  if (!parsed.success)
    throw new AiProviderError('invalid_output', 'usage', {
      diagnostic: 'schema_mismatch'
    })
  const output = parsed.data
  let html: string | null = null
  const limits: string[] = []
  if (context.format === 'html' && segments) {
    try {
      const rewritten = rewriteHtml(
        context.original,
        output.segments,
        output.cta_url
      )
      html = rewritten.html
      if (rewritten.cssText)
        limits.push(
          'The original styles add some words of their own. Check the preview for leftover text.'
        )
    } catch {
      throw new AiProviderError('invalid_output', 'usage', {
        diagnostic: 'segment_mismatch'
      })
    }
  } else if (context.format === 'html')
    limits.push(
      'This email has too much text to rewrite inside its layout, so only the text version was rewritten.'
    )
  const visible = [
    output.subject,
    ...output.alternative_subjects,
    output.preheader,
    output.body,
    output.cta_label,
    ...output.segments.map((segment) => segment.text)
  ].join('\n')
  return {
    subject: output.subject,
    subjectOptions: [output.subject, ...output.alternative_subjects],
    preheader: output.preheader,
    body: output.body,
    cta: output.cta_label,
    url: output.cta_url,
    html,
    checks: [...limits, ...factChecks(visible, context)].slice(0, 8),
    reviewNotes: output.review_notes
      .map((note) => note.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  }
}
