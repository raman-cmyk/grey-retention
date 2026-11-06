import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { AiProviderError, type AiProvider } from '@/lib/providers/contracts'
import { logger } from '@/lib/logger'
import { rewriteSetup, type RewriteSetup } from './config'
import { emailFormat } from './html'
import { OpenAiResponsesProvider, responsesRequestBody } from './openai'
import { costMicro, estimateMicro, maxRequestBytes } from './pricing'
import { rewritePromptVersion, type BrandFacts } from './prompt'
import {
  httpsLink,
  interpretRewrite,
  prepareRewrite,
  safetyIdentifier,
  sourceHosts,
  type RewriteContext
} from './rewrite'
import { SampleRewriteProvider } from './sample'

type Db = SupabaseClient<Database>
export type RunOutcome = 'idle' | 'succeeded' | 'retrying' | 'failed' | 'stale'
export type WorkerClients = {
  /** The signed-in owner's RLS-scoped session: reads tenant data only. */
  reader: Db
  /** Server-only service client: the only caller of lease/spend/settle RPCs. */
  worker: Db
}

type Claim = {
  job_id: string
  lease_token: string
  attempt: number
  result_id: string
  source_id: string
  brand_revision: number
  options: Json
  actor: string
}

export function formatPrice(minor: number | null, currency: string) {
  if (minor === null || !Number.isSafeInteger(minor) || minor < 0) return null
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(
      minor / 100
    )
  } catch {
    return null
  }
}

export function localDate(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

async function loadContext(
  db: Db,
  tenantId: string,
  claim: Claim
): Promise<RewriteContext | 'stale' | null> {
  const options = (claim.options ?? {}) as {
    productId?: string
    offerId?: string
    note?: string
    link?: string
  }
  const [source, brand, tenant, product, offer] = await Promise.all([
    db
      .from('email_sources')
      .select('subject,original,reference_import_id')
      .eq('tenant_id', tenantId)
      .eq('id', claim.source_id)
      .maybeSingle(),
    db
      .from('brand_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db.from('tenants').select('timezone').eq('id', tenantId).maybeSingle(),
    options.productId
      ? db
          .from('products')
          .select('title,url,price_minor,currency')
          .eq('tenant_id', tenantId)
          .eq('id', options.productId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    options.offerId
      ? db
          .from('offers')
          .select('label,kind,depth_percent,conditions,starts_at,ends_at')
          .eq('tenant_id', tenantId)
          .eq('id', options.offerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ])
  if (
    source.error ||
    brand.error ||
    tenant.error ||
    product.error ||
    offer.error
  )
    return null
  if (!source.data || !brand.data || !tenant.data) return null
  if (brand.data.revision !== claim.brand_revision) return 'stale'
  if ((options.productId && !product.data) || (options.offerId && !offer.data))
    return null
  const imported = await db
    .from('reference_imports')
    .select('source_url')
    .eq('tenant_id', tenantId)
    .eq('id', source.data.reference_import_id)
    .maybeSingle()
  const timezone = tenant.data.timezone
  const website = httpsLink(brand.data.domain)
  const productUrl = product.data ? httpsLink(product.data.url) : null
  const links = [httpsLink(options.link), productUrl, website].filter(
    (link): link is string => !!link
  )
  const facts: BrandFacts = {
    name: brand.data.brand_name,
    website: website ?? '',
    positioning: brand.data.positioning,
    voice: brand.data.voice,
    rules: brand.data.prohibitions,
    product: product.data
      ? {
          title: product.data.title,
          url: productUrl ?? '',
          price: formatPrice(product.data.price_minor, product.data.currency)
        }
      : null,
    offer: offer.data
      ? {
          label: offer.data.label,
          kind: offer.data.kind,
          depthPercent: offer.data.depth_percent,
          conditions: offer.data.conditions,
          startsOn: localDate(offer.data.starts_at, timezone),
          endsOn: localDate(offer.data.ends_at, timezone),
          timezone
        }
      : null
  }
  return {
    brand: facts,
    allowedLinks: [...new Set(links)].slice(0, 3),
    ownerNote: options.note ?? '',
    subject: source.data.subject,
    format: emailFormat(source.data.original),
    original: source.data.original,
    sourceHosts: sourceHosts(
      source.data.original,
      imported.data?.source_url ?? null
    )
  }
}

function providerFor(
  setup: Extract<RewriteSetup, { ready: true }>,
  fetchImpl?: typeof fetch
): AiProvider {
  return setup.provider === 'sample'
    ? new SampleRewriteProvider()
    : new OpenAiResponsesProvider({
        apiKey: setup.apiKey,
        baseUrl: setup.baseUrl,
        fetch: fetchImpl
      })
}

/**
 * Runs one rewrite if it is due. Safe to call repeatedly and concurrently:
 * the database grants one lease, one in-flight provider request, at most four
 * billable attempts (never repeating an unknown outcome automatically), and
 * applies output only to its frozen target.
 */
export async function runEmailGeneration(
  clients: WorkerClients,
  tenantId: string,
  generationId: string,
  options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}
): Promise<RunOutcome> {
  const { reader, worker } = clients
  const claimed = await worker.rpc('claim_email_generation', {
    t: tenantId,
    generation: generationId
  })
  if (claimed.error) throw claimed.error
  const claim = claimed.data?.[0] as Claim | undefined
  if (!claim) return 'idle'
  const lease = { job: claim.job_id, lease: claim.lease_token }
  const fail = async (failure: {
    code: string
    billing: 'none' | 'usage' | 'unknown'
    retryable: boolean
    costMicro?: number
    inputTokens?: number
    outputTokens?: number
    retryAfter?: number
    diagnostic?: string
  }): Promise<RunOutcome> => {
    const result = await worker.rpc('fail_email_generation', {
      ...lease,
      failure: {
        ...failure,
        ...(failure.diagnostic
          ? {
              diagnostic: failure.diagnostic
                .replace(/[^A-Za-z0-9 :_./-]/g, '')
                .slice(0, 200)
            }
          : {})
      }
    })
    if (result.error) throw result.error
    return result.data === 'retrying' ? 'retrying' : 'failed'
  }
  let dispatched = false
  let known:
    { costMicro: number; inputTokens: number; outputTokens: number } | undefined
  try {
    // Rechecked on every attempt, before any reservation or provider call, so a
    // removed or never-granted workspace fails visibly instead of spinning.
    const setup = rewriteSetup(options.env, tenantId)
    if (!setup.ready)
      return await fail({
        code: 'setup_required',
        billing: 'none',
        retryable: false,
        diagnostic: setup.reason
      })
    const context = await loadContext(reader, tenantId, claim)
    if (context === 'stale')
      return await fail({
        code: 'stale_inputs',
        billing: 'none',
        retryable: false
      })
    if (!context)
      return await fail({
        code: 'inputs_unavailable',
        billing: 'none',
        retryable: false
      })
    let prepared: ReturnType<typeof prepareRewrite>
    try {
      prepared = prepareRewrite(context, {
        model: setup.model,
        timeoutMs: setup.timeoutMs,
        safetyIdentifier: safetyIdentifier(tenantId, claim.actor)
      })
    } catch {
      return await fail({
        code: 'rejected_request',
        billing: 'none',
        retryable: false,
        diagnostic: 'no_destination'
      })
    }
    const { request, segments } = prepared
    const body = responsesRequestBody(request)
    if (Buffer.byteLength(body, 'utf8') > maxRequestBytes)
      return await fail({
        code: 'rejected_request',
        billing: 'none',
        retryable: false,
        diagnostic: 'request_too_large'
      })
    // Real money is reserved at its upper bound; the sample writer costs nothing.
    const estimate =
      setup.provider === 'openai'
        ? estimateMicro(setup.model, body, request.maxOutputTokens)
        : 1
    const dispatch = await worker.rpc('begin_email_dispatch', {
      ...lease,
      estimate,
      provider: setup.provider,
      model: setup.model,
      prompt_version: rewritePromptVersion
    })
    if (dispatch.error) {
      if (dispatch.error.code === '23514')
        return await fail({
          code: 'budget_exhausted',
          billing: 'none',
          retryable: false
        })
      if (dispatch.error.code === 'PT409')
        return await fail({
          code: 'stale_inputs',
          billing: 'none',
          retryable: false
        })
      throw dispatch.error
    }
    dispatched = true
    const priced = (usage: {
      inputTokens: number
      outputTokens: number
      cachedInputTokens?: number
    }) => (setup.provider === 'openai' ? costMicro(setup.model, usage) : 0)
    let response
    try {
      response = await providerFor(setup, options.fetch).generate(request)
    } catch (error) {
      if (!(error instanceof AiProviderError)) throw error
      const usage = error.details.usage
      return await fail({
        code: error.kind,
        billing: error.billing,
        // The database only repeats work that is known not to have been charged.
        retryable: ['rate_limited', 'unavailable', 'invalid_output'].includes(
          error.kind
        ),
        ...(usage
          ? {
              costMicro: priced(usage),
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens
            }
          : {}),
        ...(error.details.retryAfterSeconds !== undefined
          ? { retryAfter: error.details.retryAfterSeconds }
          : {}),
        diagnostic: error.details.diagnostic
      })
    }
    known = {
      costMicro: priced(response),
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens
    }
    let output
    try {
      output = interpretRewrite(response.content, context, segments)
    } catch (error) {
      return await fail({
        code: 'invalid_output',
        billing: 'usage',
        retryable: true,
        ...known,
        diagnostic:
          error instanceof AiProviderError
            ? error.details.diagnostic
            : 'invalid_output'
      })
    }
    const finished = await worker.rpc('finish_email_generation', {
      ...lease,
      output: {
        subject: output.subject,
        subjectOptions: output.subjectOptions,
        preheader: output.preheader,
        body: output.body,
        cta: output.cta,
        url: output.url,
        html: output.html,
        checks: [...output.reviewNotes, ...output.checks].slice(0, 8)
      },
      usage: {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        costMicro: known.costMicro,
        ...(response.providerResponseId
          ? { responseId: response.providerResponseId }
          : {})
      }
    })
    if (finished.error) throw finished.error
    return finished.data === null ? 'stale' : 'succeeded'
  } catch (error) {
    // Redacted: codes only, never prompt, source or output text.
    logger.error('email rewrite failed', {
      generationId,
      code: String((error as { code?: unknown })?.code ?? 'internal').slice(
        0,
        16
      )
    })
    try {
      return await fail({
        code: 'internal',
        billing: known ? 'usage' : dispatched ? 'unknown' : 'none',
        retryable: true,
        ...(known ?? {})
      })
    } catch {
      // Lost lease or closed job: the database settles it on the next claim.
      return 'failed'
    }
  }
}
