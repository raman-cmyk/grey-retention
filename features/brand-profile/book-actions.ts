'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/components/gros/action'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { rewriteBrandBookSoon } from '@/features/onboarding/brand-book-writes'
import { createClient } from '@/lib/supabase/server'
import { factInput, factKeys, type FactKey } from './book-facts'

/**
 * The owner's corrections typed into the Brand book (UI-BRAND-2). A
 * correction is the owner's own word: it outranks what the readers saw and
 * the strategist's reading, and needs no approval (it is not a brand
 * version). Owner only, here and in the database (`correct_brand_book_at`,
 * `withdraw_brand_book_correction_at`, `retry_brand_book_write`; since
 * migration 090095 ONB-058's older commands are the owner's only too), against
 * the Brand book version the page showed (a newer one is refused). The
 * database queues the rewrite with the change; it runs right after the
 * reply (`rewriteBrandBookSoon`), so the agents read the corrected book.
 */

const lineSections = [
  'offering',
  'customers.who',
  'customers.love',
  'customers.worries',
  'voice',
  'marketing'
] as const

const version = z
  .string()
  .regex(/^\d{1,9}$/, 'Open the Brand book again, then correct it.')
  .transform(Number)
const words = z
  .string()
  .trim()
  .min(1, 'Write the line first.')
  .max(300, 'Keep the line to 300 characters.')
const section = z.enum(lineSections, 'Choose a part of the Brand book.')

const lineForm = z.discriminatedUnion(
  'action',
  [
    z
      .object({
        action: z.literal('replace'),
        version,
        section,
        original: words,
        value: words
      })
      .refine((v) => same(v.original, v.value) === false, {
        message: 'Change the words first.'
      }),
    z.object({
      action: z.literal('remove'),
      version,
      section,
      original: words
    }),
    z.object({ action: z.literal('add'), version, section, value: words })
  ],
  'Choose what to do with the line.'
)

const same = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() ===
  b.trim().replace(/\s+/g, ' ').toLowerCase()

type DbError = { code?: string; message?: string; hint?: string }

/** The database's refusals in the owner's words. */
function refusal(error: DbError): ActionResult {
  if (error.hint === 'brand_book_changed')
    return {
      error:
        'Your Brand book changed since you opened it. Open it again, then correct it.'
    }
  if (error.code === '42501')
    return { error: 'Only the workspace owner can correct the Brand book.' }
  if (error.code === 'PT409') {
    const message = error.message ?? ''
    if (/already added/i.test(message))
      return { error: 'You already added this line.' }
    if (/too many added/i.test(message))
      return {
        error: 'This part already has 20 of your lines. Remove one first.'
      }
    if (/too many corrections/i.test(message))
      return {
        error:
          'You have 200 corrections already. Take one back before adding more.'
      }
    if (/not found/i.test(message))
      return { error: 'That correction was already taken back.' }
  }
  if (error.code === '23514')
    return { error: 'Check the words, then save again.' }
  return { error: 'Your correction was not saved. Try again.' }
}

/** The owner's own session, or the refusal in his words. */
async function ownerDb(
  only = 'Only the workspace owner can correct the Brand book.'
) {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { ok: false as const, refused: { error: only } }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return {
      ok: false as const,
      refused: {
        error: 'Correcting the Brand book is not available right now.'
      }
    }
  return { ok: true as const, context, db }
}

function refresh() {
  revalidatePath('/brand')
  revalidatePath('/brand/book')
}

type Correction = {
  section: string
  original: string | null
  action: 'replace' | 'remove' | 'add'
  value: string | null
}

async function correct(
  expected: number,
  corrections: Correction[],
  message: string
): Promise<ActionResult> {
  const owner = await ownerDb()
  if (!owner.ok) return owner.refused
  const { context, db } = owner
  const { error } = await db.rpc('correct_brand_book_at', {
    t: context.tenantId,
    expected_version: expected,
    corrections: corrections as never
  })
  if (error) return refusal(error)
  rewriteBrandBookSoon(context.tenantId)
  refresh()
  return { message }
}

/** Corrects one line of what GROS saw: replace it, remove it, or add one. */
export async function correctBrandBookLine(
  _state: ActionResult,
  form: FormData
): Promise<ActionResult> {
  const parsed = lineForm.safeParse(Object.fromEntries(form))
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Check the line.' }
  const v = parsed.data
  return correct(
    v.version,
    [
      {
        section: v.section,
        original: v.action === 'add' ? null : v.original,
        action: v.action,
        value: v.action === 'remove' ? null : v.value
      }
    ],
    v.action === 'remove'
      ? 'Line removed. Rewriting the Brand book.'
      : 'Saved. Rewriting the Brand book.'
  )
}

/**
 * Corrects the confirmed facts: each fact the owner changed becomes his
 * (an empty field makes it unknown, so no email claims it). `was_<fact>`
 * holds the value the form showed, so unchanged facts are left alone.
 */
export async function correctBrandBookFacts(
  _state: ActionResult,
  form: FormData
): Promise<ActionResult> {
  const expected = version.safeParse(form.get('version'))
  if (!expected.success)
    return { error: 'Open the Brand book again, then correct it.' }
  const corrections: Correction[] = []
  for (const key of factKeys) {
    const typed = factInput(key, String(form.get(key) ?? ''))
    if ('error' in typed) return { error: typed.error }
    const was = factInput(key, String(form.get(`was_${key}`) ?? ''))
    if ('value' in was && was.value === typed.value) continue
    corrections.push(factCorrection(key, typed.value))
  }
  if (!corrections.length) return { error: 'Change a fact first.' }
  return correct(
    expected.data,
    corrections,
    'Facts saved. Rewriting the Brand book.'
  )
}

const factCorrection = (key: FactKey, value: string | null): Correction => ({
  section: `facts.${key}`,
  original: null,
  action: value === null ? 'remove' : 'replace',
  value
})

const withdrawForm = z.object({
  version,
  correction: z.uuid('Choose a correction.')
})

/** Takes one of the owner's corrections back: the line is as GROS read it. */
export async function withdrawBrandBookCorrection(
  _state: ActionResult,
  form: FormData
): Promise<ActionResult> {
  const parsed = withdrawForm.safeParse(Object.fromEntries(form))
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Choose a correction.' }
  const owner = await ownerDb()
  if (!owner.ok) return owner.refused
  const { context, db } = owner
  const { error } = await db.rpc('withdraw_brand_book_correction_at', {
    t: context.tenantId,
    expected_version: parsed.data.version,
    correction: parsed.data.correction
  })
  if (error) return refusal(error)
  rewriteBrandBookSoon(context.tenantId)
  refresh()
  return { message: 'Taken back. Rewriting the Brand book.' }
}

/** Try again after a rewrite failed or never started. */
export async function retryBrandBookRewrite(): Promise<ActionResult> {
  const owner = await ownerDb(
    'Only the workspace owner can rewrite the Brand book.'
  )
  if (!owner.ok) return owner.refused
  const { context, db } = owner
  const { error } = await db.rpc('retry_brand_book_write', {
    t: context.tenantId
  })
  if (error)
    return {
      error:
        error.code === '42501'
          ? 'Only the workspace owner can rewrite the Brand book.'
          : 'The rewrite did not start. Try again in a minute.'
    }
  rewriteBrandBookSoon(context.tenantId)
  refresh()
  return { message: 'Rewriting the Brand book.' }
}
