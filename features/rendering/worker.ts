import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/service'
import { renderStrip, sections, stripSchema } from './renderer'
export async function runRenderJob(
  db: SupabaseClient<Database>,
  job: Database['public']['Tables']['job_runs']['Row']
) {
  const input = z
    .object({
      brand: z.number(),
      copy: z.number(),
      design: z.number(),
      channel: z.enum(['email_design', 'email_text']),
      assets: z.record(z.string(), z.number()),
      baseRenderId: z.uuid().nullable(),
      section: z.enum(sections).nullable(),
      feedback: z.string().nullable(),
      structure: z.array(z.string()).optional()
    })
    .parse(job.input)
  const [c, b, k, v, assets, base] = await Promise.all([
    db.from('campaigns').select('title').eq('id', job.campaign_id!).single(),
    db
      .from('brand_profiles')
      .select('brand_name')
      .eq('tenant_id', job.tenant_id)
      .single(),
    db
      .from('brand_kits')
      .select('*')
      .eq('tenant_id', job.tenant_id)
      .maybeSingle(),
    db
      .from('campaign_content')
      .select('*')
      .eq('campaign_id', job.campaign_id!)
      .eq('revision', input.copy)
      .single(),
    db
      .from('assets')
      .select('id,storage_path,media_type,category')
      .in('id', Object.keys(input.assets)),
    db
      .from('design_renders')
      .select('*')
      .eq('id', input.baseRenderId ?? '00000000-0000-4000-8000-000000000000')
      .maybeSingle()
  ])
  if ([c, b, k, v, assets, base].some((r) => r.error) || !v.data || !b.data)
    throw new Error('Render context unavailable')
  const service = createServiceClient()
  if (!service) throw new Error('Private renderer Storage unavailable')
  let embedded: { mediaType: string; base64: string } | undefined
  if (input.channel === 'email_design') {
    const asset =
      assets.data?.find((a) => a.category !== 'logo') ?? assets.data?.[0]
    if (!asset) throw new Error('Asset missing')
    const download = await db.storage
      .from('brand-assets')
      .download(asset.storage_path)
    if (download.error) throw new Error('Asset unavailable')
    embedded = {
      mediaType: asset.media_type,
      base64: Buffer.from(await download.data.arrayBuffer()).toString('base64')
    }
  }
  const priorInput = z
    .object({
      brand: z.number(),
      kit: z.number().nullable(),
      assets: z.record(z.string(), z.number())
    })
    .safeParse(base.data?.input_revisions)
  const currentInput = job.input as { brand: number; kit: number | null }
  const canReuse =
    priorInput.success &&
    priorInput.data.brand === currentInput.brand &&
    priorInput.data.kit === currentInput.kit &&
    Object.keys(priorInput.data.assets).length ===
      Object.keys(input.assets).length &&
    Object.entries(input.assets).every(
      ([id, revision]) => priorInput.data.assets[id] === revision
    )
  const strips: {
    section: (typeof sections)[number]
    path: string
    copyRevision: number
  }[] = []
  for (const section of input.channel === 'email_text' ? [] : sections) {
    const old =
      base.data?.copy_revision === input.copy
        ? z
            .array(stripSchema)
            .parse(base.data.strips)
            .find((s) => s.section === section)
        : null
    if (canReuse && input.section && input.section !== section && old) {
      strips.push({ section, path: old.path, copyRevision: input.copy })
      continue
    }
    const { svg } = renderStrip({
      section,
      structure: input.structure,
      brand: b.data.brand_name,
      subject: v.data.subject,
      body: v.data.body,
      cta: v.data.cta,
      color: k.data?.colors[0] ?? '#222222',
      font: k.data?.fonts[0] ?? 'Arial',
      asset: embedded,
      feedback:
        section === input.section ? (input.feedback ?? undefined) : undefined
    })
    const bytes = Buffer.from(svg),
      hash = createHash('sha256').update(bytes).digest('hex'),
      path = `${job.tenant_id}/${job.id}/${hash}.svg`
    const up = await service.storage
      .from('email-artifacts')
      .upload(path, bytes, { contentType: 'image/svg+xml', upsert: false })
    if (up.error && up.error.message !== 'The resource already exists')
      throw new Error('Render upload unavailable')
    const proof = await service.rpc('record_render_upload', {
      job: job.id,
      lease: job.lease_token!,
      path,
      section,
      hash,
      byte_size: bytes.length
    })
    if (proof.error) throw proof.error
    strips.push({ section, path, copyRevision: input.copy })
  }
  const done = await db.rpc('finish_render_job', {
    job: job.id,
    lease: job.lease_token!,
    output: { synthetic: true, strips }
  })
  if (done.error) throw done.error
}
