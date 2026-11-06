'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'
import {
  contentSchema,
  factsSchema,
  hasFacts,
  readSectionForm,
  sectionKeys,
  type SectionContent,
  type SectionKey
} from './sections'
import { brandProfileWriter, type WriterFacts } from './writer'

const revision = z.string().regex(/^\d+$/).transform(Number)
const target = z.object({
  section: z.enum(sectionKeys as [SectionKey, ...SectionKey[]]),
  revision
})
type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>

async function ownerSession() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return {
      error: 'Only the workspace owner can change the Brand profile.'
    } as const
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return {
      error: 'Please sign in again. Your changes are still here.'
    } as const
  return { context, db } as const
}

/** Owner-facing text for a refused command (no codes, nothing technical). */
function failed(error: { code?: string; message?: string }) {
  const text = error.message ?? ''
  if (error.code === 'PT409')
    return text.startsWith('Brand details changed')
      ? 'Your brand details were changed somewhere else (for example on Get started). Reload the page to see them, then edit again.'
      : 'This section changed in another window. Reload the page to see the latest version.'
  if (error.code === '42501')
    return 'Only the workspace owner can change the Brand profile.'
  if (error.code === '23514') {
    if (text.startsWith('Cancel or reconcile active delivery'))
      return 'A campaign is on its way to Klaviyo right now. Wait until it is scheduled, or cancel it, before changing the brand details.'
    if (text.startsWith('Save the Brand Identity first'))
      return 'Save the Brand Identity first (it needs a brand name).'
    if (text.startsWith('Brand name')) return 'Brand name: 2 to 120 characters.'
    return 'Check the fields and try again.'
  }
  return 'We could not save this section. Nothing was changed. Try again.'
}

function refresh() {
  for (const path of [
    '/brand',
    '/store',
    '/connections',
    '/dashboard',
    '/get-started',
    '/campaign-agent'
  ])
    revalidatePath(path)
}

const saved = z.object({ revision: z.number(), brand_changed: z.boolean() })

/**
 * Owner edit of one section, with the fields the owner chose to lock. On
 * Identity and Tone the brand facts are saved too, but only if nobody changed
 * them since the page loaded.
 */
export async function saveBrandSection(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const picked = target.safeParse({
    section: form.get('section'),
    revision: form.get('revision')
  })
  if (!picked.success) return { error: 'Reload the page and try again.' }
  const { section } = picked.data
  const brandRevision = hasFacts(section)
    ? revision.safeParse(form.get('brand_revision'))
    : null
  if (brandRevision && !brandRevision.success)
    return { error: 'Reload the page and try again.' }
  const { content, facts, locked } = readSectionForm(section, form)
  const validContent = contentSchema(section).safeParse(content)
  if (!validContent.success)
    return {
      error: validContent.error.issues[0]?.message ?? 'Check the fields.'
    }
  const validFacts = facts ? factsSchema(section).safeParse(facts) : null
  if (validFacts && !validFacts.success)
    return { error: validFacts.error.issues[0]?.message ?? 'Check the fields.' }
  const { context, db } = session
  const result = await db.rpc('save_brand_section', {
    t: context.tenantId,
    section,
    expected_revision: picked.data.revision,
    content: validContent.data as Json,
    locked,
    ...(validFacts && brandRevision?.success
      ? {
          facts: validFacts.data as Json,
          expected_brand_revision: brandRevision.data
        }
      : {})
  })
  if (result.error) return { error: failed(result.error) }
  refresh()
  const outcome = saved.safeParse(result.data)
  return {
    message:
      outcome.success && outcome.data.brand_changed
        ? 'Saved. Your brand details changed: approve the brand again before the AI uses them. Campaigns not sent yet went back to draft.'
        : 'Saved.'
  }
}

async function writerFacts(
  db: Db,
  tenantId: string,
  fallbackName: string
): Promise<WriterFacts> {
  const [brand, products] = await Promise.all([
    db
      .from('brand_profiles')
      .select('brand_name')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('products')
      .select('title,url')
      .eq('tenant_id', tenantId)
      .order('created_at')
      .limit(20)
  ])
  return {
    brandName: brand.data?.brand_name ?? fallbackName,
    products: products.data ?? []
  }
}

type Current = { content: SectionContent; locked: string[] }
async function currentSections(db: Db, tenantId: string) {
  const rows = await db
    .from('brand_profile_sections')
    .select('section,content,locked')
    .eq('tenant_id', tenantId)
  if (rows.error) return null
  return new Map<string, Current>(
    (rows.data ?? []).map((row) => [
      row.section,
      {
        content: (row.content ?? {}) as SectionContent,
        locked: row.locked ?? []
      }
    ])
  )
}

const fieldCount = (n: number) =>
  n === 1 ? '1 empty field' : `${n} empty fields`
const nothingToAdd =
  'Nothing to add: every field already has text. The sample writer only fills empty fields (real AI is not switched on).'

/** "Redo with AI" for one section; owner text and locked fields are kept. */
export async function redoBrandSection(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const picked = target.safeParse({
    section: form.get('section'),
    revision: form.get('revision')
  })
  if (!picked.success) return { error: 'Reload the page and try again.' }
  const writer = brandProfileWriter(getServerEnvironment().AI_DEFAULT_PROVIDER)
  if (!writer)
    return {
      error: 'AI suggestions are not switched on yet. Nothing was changed.'
    }
  const { context, db } = session
  const [facts, current] = await Promise.all([
    writerFacts(db, context.tenantId, context.tenantName),
    currentSections(db, context.tenantId)
  ])
  if (!current) return { error: failed({}) }
  const { section } = picked.data
  const suggestion = await writer.suggest({
    section,
    facts,
    current: current.get(section)?.content ?? {},
    locked: current.get(section)?.locked ?? []
  })
  const filled = Object.keys(suggestion).length
  if (!filled) return { message: nothingToAdd }
  const applied = await db.rpc('apply_brand_suggestion', {
    t: context.tenantId,
    section,
    expected_revision: picked.data.revision,
    suggestion: suggestion as Json
  })
  if (applied.error) return { error: failed(applied.error) }
  refresh()
  return {
    message: `Sample text added to ${fieldCount(filled)} (not real AI, nothing was spent). Your own words and locked fields were kept.`
  }
}

/** "Redo all with AI": every section, each with its own revision check. */
export async function redoAllBrandSections(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  // Read and check every revision first, so nothing changes on a bad form.
  const revisions = z
    .array(revision)
    .length(sectionKeys.length)
    .safeParse(sectionKeys.map((section) => form.get(`revision:${section}`)))
  if (!revisions.success) return { error: 'Reload the page and try again.' }
  const writer = brandProfileWriter(getServerEnvironment().AI_DEFAULT_PROVIDER)
  if (!writer)
    return {
      error: 'AI suggestions are not switched on yet. Nothing was changed.'
    }
  const { context, db } = session
  const [facts, current] = await Promise.all([
    writerFacts(db, context.tenantId, context.tenantName),
    currentSections(db, context.tenantId)
  ])
  if (!current) return { error: failed({}) }
  let filled = 0
  for (const [index, section] of sectionKeys.entries()) {
    const suggestion = await writer.suggest({
      section,
      facts,
      current: current.get(section)?.content ?? {},
      locked: current.get(section)?.locked ?? []
    })
    const count = Object.keys(suggestion).length
    if (!count) continue
    const applied = await db.rpc('apply_brand_suggestion', {
      t: context.tenantId,
      section,
      expected_revision: revisions.data[index]!,
      suggestion: suggestion as Json
    })
    if (applied.error) {
      refresh()
      return {
        error: `${filled ? `Sample text added to ${fieldCount(filled)} before this stopped. ` : ''}${failed(applied.error)}`
      }
    }
    filled += count
  }
  if (!filled) return { message: nothingToAdd }
  refresh()
  return {
    message: `Sample text added to ${fieldCount(filled)} across the profile (not real AI, nothing was spent). Your own words and locked fields were kept.`
  }
}
