'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import type { Route } from 'next'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rewriteAvailability } from './config'
import { editHtml, emailFormat, htmlEditable, htmlToText } from './html'
import { htmlFingerprint, httpsLink } from './rewrite'
import { runEmailGeneration } from './worker'

/** Stable per-attempt key for one choice, so double submits replay safely. */
function requestKey(attempt: string, label: string) {
  const h = createHash('sha256').update(`${attempt}:${label}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

async function ownerSession(message: string) {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner') return { error: message } as const
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return {
      error: 'Please sign in again. Your changes are still here.'
    } as const
  return { context, db } as const
}

/** Starts provider work after the response, through the server-only worker. */
async function startRewrite(tenantId: string, generationId: string) {
  const reader = await createClient()
  const worker = createServiceClient()
  if (!reader || !worker) return
  after(async () => {
    try {
      await runEmailGeneration({ reader, worker }, tenantId, generationId)
    } catch {
      // The result page shows the persisted state and can resume the job.
    }
  })
}

const optionalId = z.uuid().or(z.literal('')).optional()
const chooseSchema = z.object({
  attempt: z.uuid(),
  importId: z.uuid(),
  mode: z.enum(['copy', 'rewrite']),
  productId: optionalId,
  offerId: optionalId,
  link: z.string().trim().max(2000).optional(),
  note: z.string().trim().max(500).optional()
})

function rpcMessage(code: string | undefined, fallback: string) {
  return code === 'PT409'
    ? 'This email changed in another window. Reload to see the latest version.'
    : code === '42501'
      ? 'This email is not available in this workspace.'
      : code === '23514'
        ? 'Check the details and try again.'
        : fallback
}

export async function chooseEmailOutcome(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession('Ask your workspace owner to make emails.')
  if ('error' in session) return { error: session.error }
  const { context, db } = session
  const parsed = chooseSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Check your choices and try again.' }
  const x = parsed.data
  const imported = await db
    .from('reference_imports')
    .select('original_body')
    .eq('tenant_id', context.tenantId)
    .eq('id', x.importId)
    .maybeSingle()
  if (imported.error || !imported.data)
    return { error: 'This email is not available in this workspace.' }
  const options: Record<string, string> = {}
  if (x.mode === 'copy') {
    if (emailFormat(imported.data.original_body) === 'html')
      options.textVersion = htmlToText(imported.data.original_body).slice(
        0,
        100_000
      )
  } else {
    const availability = rewriteAvailability(context.tenantId)
    if (!availability.ready)
      return {
        error:
          'Rewriting is not set up yet. An administrator needs to finish the AI setup. You can copy this email now instead.'
      }
    if (x.productId) options.productId = x.productId
    if (x.offerId) options.offerId = x.offerId
    if (x.note) options.note = x.note
    if (x.link) {
      const link = httpsLink(x.link)
      if (!link)
        return {
          error:
            'Use a full web address starting with https://, or leave it blank.'
        }
      options.link = link
    }
    const brand = await db
      .from('brand_profiles')
      .select('domain')
      .eq('tenant_id', context.tenantId)
      .maybeSingle()
    if (!brand.data) return { error: 'Save your brand basics first.' }
    if (!options.link && !options.productId && !httpsLink(brand.data.domain))
      return {
        error:
          'Add your store website in brand basics, or a link for the button, so the email has somewhere to point.'
      }
  }
  const created = await db.rpc('create_email_result', {
    t: context.tenantId,
    request_key: requestKey(x.attempt, x.mode),
    import_id: x.importId,
    mode: x.mode,
    options
  })
  if (created.error || !created.data)
    return {
      error: rpcMessage(
        created.error?.code,
        'We could not save this. Your choice is still here; try again.'
      )
    }
  if (x.mode === 'rewrite') {
    const generation = await db
      .from('email_generations')
      .select('id,state')
      .eq('tenant_id', context.tenantId)
      .eq('result_id', created.data)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (
      generation.data &&
      ['queued', 'running'].includes(generation.data.state)
    )
      await startRewrite(context.tenantId, generation.data.id)
  }
  for (const path of [
    '/get-started',
    '/dashboard',
    `/create-email/${x.importId}`
  ])
    revalidatePath(path)
  redirect(`/emails/${created.data}` as Route)
}

const versionSchema = z.object({
  resultId: z.uuid(),
  revision: z.coerce.number().int().min(1),
  subject: z.string().trim().min(1).max(200),
  preheader: z.string().trim().max(300),
  body: z.string().max(100_000),
  cta: z.string().trim().max(200),
  url: z.string().trim().max(2000),
  html: z.string().max(300_000).optional()
})

const blocksSchema = z.object({
  resultId: z.uuid(),
  revision: z.coerce.number().int().min(1),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  subject: z.string().trim().min(1).max(200),
  preheader: z.string().trim().max(300)
})

/**
 * Simple editing of an HTML email: the owner changes visible text blocks and
 * link destinations. The new HTML is rebuilt on the server from the stored
 * version, so layout is kept and no browser-supplied markup is accepted.
 */
async function saveEmailBlocks(
  session: {
    context: { tenantId: string }
    db: NonNullable<Awaited<ReturnType<typeof createClient>>>
  },
  form: FormData
): Promise<FormResult> {
  const parsed = blocksSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success)
    return {
      error:
        'Add a subject line (up to 200 characters) and check the other fields.'
    }
  const x = parsed.data
  const stored = await session.db
    .from('email_result_revisions')
    .select('html')
    .eq('tenant_id', session.context.tenantId)
    .eq('result_id', x.resultId)
    .eq('revision', x.revision)
    .maybeSingle()
  if (stored.error || !stored.data?.html)
    return { error: 'This email is not available in this workspace.' }
  if (htmlFingerprint(stored.data.html) !== x.fingerprint)
    return {
      error:
        'This email changed in another window. Reload to see the latest version.'
    }
  const editable = htmlEditable(stored.data.html)
  if (!editable)
    return {
      error:
        'This email is too large to edit block by block. Use the HTML editor instead.'
    }
  const texts = editable.segments.map((s) => form.get(`text-${s.id}`))
  const hrefs = editable.links.map((l) => form.get(`link-${l.id}`))
  if (
    texts.some((t) => typeof t !== 'string' || t.length > 2000) ||
    hrefs.some((h) => typeof h !== 'string')
  )
    return {
      error:
        'This email changed in another window. Reload to see the latest version.'
    }
  const links: string[] = []
  for (const [index, raw] of (hrefs as string[]).entries()) {
    const value = raw.trim()
    if (value === editable.links[index].href) links.push(value)
    else {
      const link = httpsLink(value)
      if (!link) return { error: 'Links must be full https:// addresses.' }
      links.push(link)
    }
  }
  const primaryId = form.get('primary')
  const chosen =
    primaryId === 'none' || primaryId === null ? null : Number(primaryId)
  if (
    chosen !== null &&
    !(Number.isInteger(chosen) && chosen >= 0 && chosen < editable.links.length)
  )
    return {
      error:
        'This email changed in another window. Reload to see the latest version.'
    }
  const html = editHtml(stored.data.html, texts as string[], links)
  // Only the chosen anchor becomes the approval button; other links stay as they are.
  const button = chosen === null ? null : htmlEditable(html)?.links[chosen]
  if (button && !button.text)
    return {
      error:
        'Choose a main button that has words on it, not an image-only link.'
    }
  const buttonUrl = button ? httpsLink(button.href) : null
  if (button && !buttonUrl)
    return { error: 'The main button needs a full https:// link.' }
  const saved = await session.db.rpc('save_email_revision', {
    t: session.context.tenantId,
    result: x.resultId,
    expected_revision: x.revision,
    input: {
      subject: x.subject,
      preheader: x.preheader,
      body: htmlToText(html).slice(0, 100_000),
      cta: button?.text.slice(0, 200) ?? '',
      url: buttonUrl ?? '',
      html
    }
  })
  if (saved.error || !saved.data)
    return {
      error: rpcMessage(
        saved.error?.code,
        'We could not save this version. Your edits are still here; try again.'
      )
    }
  revalidatePath(`/emails/${x.resultId}`)
  redirect(`/emails/${x.resultId}` as Route)
}

export async function saveEmailVersion(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession(
    'Ask your workspace owner to edit this email.'
  )
  if ('error' in session) return { error: session.error }
  if (form.get('editor') === 'blocks') return saveEmailBlocks(session, form)
  const parsed = versionSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success)
    return {
      error:
        'Add a subject line (up to 200 characters) and check the other fields.'
    }
  const x = parsed.data
  const url = x.url ? httpsLink(x.url) : ''
  if (url === null)
    return { error: 'The button link must be a full https:// address.' }
  if (x.html !== undefined && !x.html.trim())
    return {
      error: 'The HTML cannot be empty. Restore an earlier version instead.'
    }
  const saved = await session.db.rpc('save_email_revision', {
    t: session.context.tenantId,
    result: x.resultId,
    expected_revision: x.revision,
    input: {
      subject: x.subject,
      preheader: x.preheader,
      body: x.body.replace(/\r\n?/g, '\n'),
      cta: x.cta,
      url,
      ...(x.html !== undefined ? { html: x.html } : {})
    }
  })
  if (saved.error || !saved.data)
    return {
      error: rpcMessage(
        saved.error?.code,
        'We could not save this version. Your edits are still here; try again.'
      )
    }
  revalidatePath(`/emails/${x.resultId}`)
  redirect(`/emails/${x.resultId}` as Route)
}

export async function restoreEmailVersion(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession(
    'Ask your workspace owner to restore versions.'
  )
  if ('error' in session) return { error: session.error }
  const parsed = z
    .object({
      resultId: z.uuid(),
      revision: z.coerce.number().int().min(1),
      from: z.coerce.number().int().min(1)
    })
    .safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Choose a version to restore.' }
  const x = parsed.data
  const restored = await session.db.rpc('restore_email_revision', {
    t: session.context.tenantId,
    result: x.resultId,
    expected_revision: x.revision,
    from_revision: x.from
  })
  if (restored.error)
    return {
      error: rpcMessage(
        restored.error.code,
        'We could not restore that version. Try again.'
      )
    }
  revalidatePath(`/emails/${x.resultId}`)
  redirect(`/emails/${x.resultId}` as Route)
}

export async function rewriteAgain(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession(
    'Ask your workspace owner to rewrite this email.'
  )
  if ('error' in session) return { error: session.error }
  const parsed = z
    .object({
      resultId: z.uuid(),
      revision: z.coerce.number().int().min(0),
      attempt: z.uuid()
    })
    .safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Reload the page and try again.' }
  const x = parsed.data
  if (!rewriteAvailability(session.context.tenantId).ready)
    return {
      error:
        'Rewriting is not set up yet. An administrator needs to finish the AI setup.'
    }
  const previous = await session.db
    .from('email_generations')
    .select('options')
    .eq('tenant_id', session.context.tenantId)
    .eq('result_id', x.resultId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const requested = await session.db.rpc('request_email_rewrite', {
    t: session.context.tenantId,
    result: x.resultId,
    request_key: x.attempt,
    expected_revision: x.revision,
    options: previous.data?.options ?? {}
  })
  if (requested.error || !requested.data)
    return {
      error:
        requested.error?.message === 'A rewrite is already in progress'
          ? 'A rewrite is already in progress.'
          : rpcMessage(
              requested.error?.code,
              'We could not start a rewrite. Try again.'
            )
    }
  await startRewrite(session.context.tenantId, requested.data)
  revalidatePath(`/emails/${x.resultId}`)
  redirect(`/emails/${x.resultId}` as Route)
}

/** Called by the result page while writing: resumes due work, returns state. */
export async function checkEmailProgress(resultId: string) {
  const context = await requireRequestContext('client')
  if (!z.uuid().safeParse(resultId).success)
    return { state: 'unknown' as const }
  const db = await createClient()
  if (!db) return { state: 'unknown' as const }
  const latest = await db
    .from('email_generations')
    .select('id,state')
    .eq('tenant_id', context.tenantId)
    .eq('result_id', resultId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!latest.data) return { state: 'unknown' as const }
  if (
    context.tenantRole === 'owner' &&
    ['queued', 'running'].includes(latest.data.state)
  ) {
    const worker = createServiceClient()
    if (worker)
      await runEmailGeneration(
        { reader: db, worker },
        context.tenantId,
        latest.data.id
      ).catch(() => 'failed' as const)
    const again = await db
      .from('email_generations')
      .select('state')
      .eq('id', latest.data.id)
      .eq('tenant_id', context.tenantId)
      .maybeSingle()
    return { state: again.data?.state ?? latest.data.state }
  }
  return { state: latest.data.state }
}
