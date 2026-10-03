'use server'
import { createHash, randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { validateRaster } from '@/features/assets/raster'
import { assignmentBriefSchema, validateDesignBytes } from './uploads'
export async function assignDesigner(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  await requireRequestContext('admin')
  const parsed = z
    .object({
      tenant: z.uuid(),
      campaign: z.uuid(),
      designer: z.uuid(),
      copy: z.coerce.number().int().positive()
    })
    .safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Select an active permitted designer.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  const v = parsed.data
  const { error } = await db.rpc('assign_campaign', {
    t: v.tenant,
    campaign: v.campaign,
    designer: v.designer,
    expected_copy: v.copy
  })
  if (error)
    return {
      error:
        error.code === '23514' || error.code === '40001'
          ? error.message
          : 'Assignment denied or unavailable.'
    }
  revalidatePath('/admin/designers')
  revalidatePath('/designer/dashboard')
  revalidatePath(`/campaigns/${v.campaign}`)
  return {
    message: 'Approved brief assigned. Owner retains final design approval.'
  }
}
export async function submitDesign(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('designer')
  const parsed = z
    .object({
      assignment: z.uuid(),
      revision: z.coerce.number().int().positive(),
      notes: z.string().max(5000)
    })
    .safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Invalid assignment or notes.' }
  const db = await createClient()
  const service = createServiceClient()
  if (!db || !service || process.env.AUTH_MODE === 'demo')
    return {
      error:
        'Private upload verification is unavailable. Configure server-side local Supabase credentials.'
    }
  let path: string | undefined
  let stored = false
  let committed = false
  try {
    const briefResult = await db.rpc('assignment_brief', {
      assignment: parsed.data.assignment
    })
    if (briefResult.error) throw new Error('Assignment access denied.')
    const brief = assignmentBriefSchema.parse(briefResult.data)
    if (brief.stale || brief.designRevision !== parsed.data.revision)
      throw new Error('The brief changed. Refresh before submitting.')
    const file = form.get('design')
    if (!(file instanceof File))
      throw new Error('Choose a PNG, JPEG or WebP design.')
    if (file.size > 10 * 1024 * 1024)
      throw new Error('Maximum design size is 10 MiB.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { mediaType, extension } = validateDesignBytes(bytes, file.name)
    validateRaster(bytes, mediaType)
    path = `${brief.tenantId}/${brief.assignmentId}/${randomUUID()}.${extension}`
    const upload = await service.storage
      .from('designer-submissions')
      .upload(path, bytes, { contentType: mediaType, upsert: false })
    if (upload.error)
      throw new Error('Private upload failed. Retry after checking Storage.')
    stored = true
    const proof = await service.rpc('record_design_upload', {
      assignment: brief.assignmentId,
      actor: context.userId,
      path,
      hash: createHash('sha256').update(bytes).digest('hex'),
      media_type: mediaType,
      byte_size: bytes.length
    })
    if (proof.error) throw new Error('Upload validation could not be recorded.')
    const submission = await db.rpc('submit_design', {
      assignment: brief.assignmentId,
      expected_revision: parsed.data.revision,
      path,
      notes: parsed.data.notes
    })
    if (submission.error)
      throw new Error(
        'Submission is stale or unavailable. Refresh the assignment.'
      )
    committed = true
    revalidatePath('/designer/dashboard')
    revalidatePath(`/designer/assignments/${brief.assignmentId}`)
    revalidatePath(`/campaigns/${brief.campaignId}`)
    return { message: 'New design version submitted to the brand owner.' }
  } catch (error) {
    if (stored && !committed && path)
      await service.storage.from('designer-submissions').remove([path])
    return {
      error:
        error instanceof Error ? error.message : 'Design submission failed.'
    }
  }
}
