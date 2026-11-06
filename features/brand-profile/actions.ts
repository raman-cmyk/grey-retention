'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'
import {
  contentSchema,
  readSectionForm,
  sectionKeys,
  type SectionKey
} from './sections'
import { brandProfileWriter, type BrandFacts } from './writer'

const target = z.object({
  section: z.enum(sectionKeys as [SectionKey, ...SectionKey[]]),
  revision: z.string().regex(/^\d+$/).transform(Number)
})

async function ownerSession() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return {
      error: 'Only the workspace owner can change the Brand profile.'
    } as const
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return {
      error: 'Please sign in again. Your changes are still here.'
    } as const
  return { context, db } as const
}

function failed(code: string | undefined) {
  if (code === 'PT409')
    return 'This section changed in another window. Reload the page to see the latest version.'
  if (code === '42501')
    return 'Only the workspace owner can change the Brand profile.'
  if (code === '23514') return 'Check the fields and try again.'
  return 'We could not save this section. Nothing was changed. Try again.'
}

function refresh() {
  for (const path of ['/brand', '/connections', '/dashboard', '/get-started'])
    revalidatePath(path)
}

const approvalNote =
  ' Your brand needs approving again before the AI uses the change.'

/** Owner edit of one section, with the fields the owner chose to lock. */
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
  const { section, revision } = picked.data
  const { content, locked } = readSectionForm(section, form)
  const valid = contentSchema(section).safeParse(content)
  if (!valid.success)
    return { error: valid.error.issues[0]?.message ?? 'Check the fields.' }
  const { context, db } = session
  const saved = await db.rpc('save_brand_section', {
    t: context.tenantId,
    section,
    expected_revision: revision,
    content: valid.data as Json,
    locked
  })
  if (saved.error) return { error: failed(saved.error.code) }
  refresh()
  return {
    message: `Saved.${section === 'identity' || section === 'tone' ? approvalNote : ''}`
  }
}

async function facts(
  db: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  tenantId: string,
  fallbackName: string
): Promise<BrandFacts> {
  const [brand, products] = await Promise.all([
    db
      .from('brand_profiles')
      .select('brand_name,domain,positioning,voice,prohibitions')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('products')
      .select('title,url')
      .eq('tenant_id', tenantId)
      .order('title')
      .limit(20)
  ])
  return {
    brandName: brand.data?.brand_name ?? fallbackName,
    website: brand.data?.domain ?? '',
    positioning: brand.data?.positioning ?? '',
    voice: brand.data?.voice ?? '',
    prohibitions: brand.data?.prohibitions ?? '',
    products: products.data ?? []
  }
}

/** "Redo with AI" for one section; fields the owner locked are kept. */
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
  const writer = brandProfileWriter()
  if (!writer)
    return {
      error: 'AI suggestions are not switched on yet. Nothing was changed.'
    }
  const { context, db } = session
  const known = await facts(db, context.tenantId, context.tenantName)
  const suggestion = await writer.suggest(picked.data.section, known)
  const applied = await db.rpc('apply_brand_suggestion', {
    t: context.tenantId,
    section: picked.data.section,
    expected_revision: picked.data.revision,
    suggestion: suggestion as Json
  })
  if (applied.error) return { error: failed(applied.error.code) }
  refresh()
  return {
    message: writer.live
      ? 'Updated. Fields you locked were kept.'
      : 'Sample suggestion applied (not real AI, nothing was spent). Fields you locked were kept.'
  }
}

/** "Redo all with AI": every section, each with its own revision check. */
export async function redoAllBrandSections(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const writer = brandProfileWriter()
  if (!writer)
    return {
      error: 'AI suggestions are not switched on yet. Nothing was changed.'
    }
  const { context, db } = session
  const known = await facts(db, context.tenantId, context.tenantName)
  // Read and check every revision first, so nothing changes on a bad form.
  const revisions = z
    .array(z.string().regex(/^\d+$/).transform(Number))
    .length(sectionKeys.length)
    .safeParse(sectionKeys.map((section) => form.get(`revision:${section}`)))
  if (!revisions.success) return { error: 'Reload the page and try again.' }
  let done = 0
  for (const [index, section] of sectionKeys.entries()) {
    const applied = await db.rpc('apply_brand_suggestion', {
      t: context.tenantId,
      section,
      expected_revision: revisions.data[index]!,
      suggestion: (await writer.suggest(section, known)) as Json
    })
    if (applied.error) {
      refresh()
      return {
        error: `${done} of ${sectionKeys.length} sections updated. ${failed(applied.error.code)}`
      }
    }
    done++
  }
  refresh()
  return {
    message: writer.live
      ? 'All sections updated. Fields you locked were kept.'
      : 'Sample suggestions applied to every section (not real AI, nothing was spent). Fields you locked were kept.'
  }
}
