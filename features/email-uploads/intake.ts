import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { readDesignFile } from '@/features/email-import/parse'
import type { PhotoOpener } from '@/features/design-engine/photos'
import type { Database, Json } from '@/lib/supabase/database.types'
import {
  designFileKind,
  uploadDesigns,
  uploadLimits,
  uploadRefusal,
  type UploadDesign
} from './limits'
import { prepareUpload, type PreparedPicture } from './prepare'

type Db = SupabaseClient<Database>

/**
 * DES-ENGINE-003: adding one email file, in order (each step can be done
 * again: a retry with the same request key resumes where the last one
 * stopped):
 * 1. the file is checked and read (`readDesignFile`: the existing safe
 *    intake rules, HTML or .eml only) and made ready (`prepareUpload`:
 *    its pictures read from the file, or fetched from the fixed hosts);
 *    nothing is stored yet;
 * 2. `add_email_upload` (the member's own session: the owner or an admin,
 *    under the workspace lock) saves the row and its bounds;
 * 3. the server writes the files with its own key, never over a stored
 *    one: the original exactly as uploaded, the prepared HTML, the kept
 *    pictures;
 * 4. `finish_email_upload` checks every file is stored and queues it to
 *    be measured by the browser job.
 */

export const uploadBucket = 'email-uploads'

export const uploadForm = z.object({
  requestKey: z.uuid(),
  name: z.string().trim().max(uploadLimits.name),
  design: z.enum(uploadDesigns)
})

const extension: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

export const picturePath = (
  tenant: string,
  upload: string,
  p: Pick<PreparedPicture, 'index' | 'type'>
) => `${tenant}/${upload}/picture-${p.index}.${extension[p.type] ?? 'png'}`

/** The name to keep: the owner's, else the file's title, else its name. */
export function uploadName(typed: string, title: string, fileName: string) {
  const clean = (s: string) =>
    s
      .replace(
        /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim()
  const name =
    clean(typed) ||
    clean(title) ||
    clean(fileName.replace(/\.[a-z0-9]{1,8}$/i, '')) ||
    'My email'
  // Cut on whole letters as a reader sees them (an emoji, an accent).
  const graphemes = [
    ...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(name)
  ].map((g) => g.segment)
  let out = ''
  for (const g of graphemes) {
    if ([...out].length + [...g].length > uploadLimits.name) break
    out += g
  }
  return out.trim()
}

/** The pictures a row was saved with are these, one for one (by their bytes' hash). */
function samePictures(saved: unknown, pictures: readonly PreparedPicture[]) {
  if (!Array.isArray(saved) || saved.length !== pictures.length) return false
  return pictures.every((p, i) => {
    const s = saved[i] as Record<string, unknown> | null
    return (
      !!s &&
      s.index === p.index &&
      s.type === p.type &&
      s.sha256 === p.sha256 &&
      s.bytes === p.bytes.byteLength
    )
  })
}

export type IntakeResult =
  | { ok: true; id: string; state: string; missing: number }
  | { ok: false; error: string }

const refused = (code?: string | null): IntakeResult => ({
  ok: false,
  error: uploadRefusal(code)
})

export async function addUploadFile(input: {
  db: Db
  service: Db
  tenantId: string
  form: z.infer<typeof uploadForm>
  file: { name: string; bytes: Uint8Array }
  open?: PhotoOpener
}): Promise<IntakeResult> {
  const { db, service, tenantId, form, file } = input
  const kind = designFileKind(file.name)
  if (!kind) return refused('unsupported_type')
  if (file.bytes.length === 0) return refused('no_content')
  if (file.bytes.length > uploadLimits.fileBytes) return refused('too_large')
  // The limits first: nothing is read or fetched for an add that would be
  // refused (the add checks them again under the workspace lock).
  const room = await db.rpc('email_upload_room', { t: tenantId })
  if (room.error)
    return refused(room.error.code === '42501' ? 'not_allowed' : 'storage')
  if (room.data !== 'ok') return refused(String(room.data))
  const read = await readDesignFile(file.bytes, kind)
  if (!read.ok) return refused(read.code)
  const design: UploadDesign = form.design
  const prepared = await prepareUpload(read.html, read.related, design, {
    open: input.open
  })
  if (!prepared.ok) return refused(prepared.code)
  const sha256 = createHash('sha256').update(file.bytes).digest('hex')
  const added = await db.rpc('add_email_upload', {
    t: tenantId,
    request: form.requestKey,
    name: uploadName(form.name, read.title, file.name),
    design,
    file_kind: kind,
    byte_size: file.bytes.length,
    sha256,
    pictures: prepared.pictures.map((p) => ({
      index: p.index,
      type: p.type,
      width: p.width,
      height: p.height,
      bytes: p.bytes.byteLength,
      sha256: p.sha256,
      from: p.from
    })) as unknown as Json,
    missing: prepared.missing as unknown as Json
  })
  const row = (added.data as { id: string; state: string }[] | null)?.[0]
  if (added.error || !row) {
    if (added.error?.code === '42501') return refused('not_allowed')
    return refused(added.error?.hint)
  }
  if (row.state === 'saving') {
    // A retry of the same request: its pictures must be the ones the row
    // was saved with (a web picture may answer differently the second
    // time), or the stored files would not match it.
    const saved = await db
      .from('email_uploads')
      .select('pictures')
      .eq('id', row.id)
      .maybeSingle()
    if (saved.error || !saved.data) return refused('storage')
    if (!samePictures(saved.data.pictures, prepared.pictures))
      return refused('upload_changed')
    const base = `${tenantId}/${row.id}`
    const files: { path: string; body: Uint8Array | Buffer; type: string }[] = [
      {
        path: `${base}/original.${kind}`,
        body: file.bytes,
        type: kind === 'eml' ? 'message/rfc822' : 'text/html'
      },
      {
        path: `${base}/email.html`,
        body: Buffer.from(prepared.html, 'utf8'),
        type: 'text/html'
      },
      ...prepared.pictures.map((p) => ({
        path: picturePath(tenantId, row.id, p),
        body: p.bytes,
        type: p.type
      }))
    ]
    const bucket = service.storage.from(uploadBucket)
    const put = (f: (typeof files)[number]) =>
      bucket.upload(f.path, f.body, { contentType: f.type, upsert: false })
    for (const f of files) {
      let stored = await put(f)
      // Never over a stored file: one already there is this upload's own
      // (an earlier try of it). The original and the pictures are the
      // same bytes (the same hash); the prepared HTML of an earlier try
      // that differs (its size) is replaced, since nothing uses an
      // unfinished upload yet. The finish pins each one's size and tag.
      if (stored.error && /exists|duplicate/i.test(stored.error.message)) {
        if (!f.path.endsWith('/email.html')) continue
        const listed = await bucket.list(base, { search: 'email.html' })
        const now = listed.data?.find((o) => o.name === 'email.html')
        if (Number(now?.metadata?.size) === f.body.byteLength) continue
        const removed = await bucket.remove([f.path])
        if (removed.error) return refused('storage')
        stored = await put(f)
      }
      if (stored.error) return refused('storage')
    }
    const finished = await db.rpc('finish_email_upload', {
      t: tenantId,
      upload: row.id,
      html_size: Buffer.byteLength(prepared.html, 'utf8')
    })
    if (finished.error) {
      // Deleted while its files were written: nothing may stay behind.
      if (finished.error.hint === 'upload_gone')
        await service.storage
          .from(uploadBucket)
          .remove(files.map((f) => f.path))
      return refused(finished.error.hint)
    }
    return {
      ok: true,
      id: row.id,
      state: String(finished.data),
      missing: prepared.missing.reduce((n, m) => n + m.count, 0)
    }
  }
  return {
    ok: true,
    id: row.id,
    state: row.state,
    missing: prepared.missing.reduce((n, m) => n + m.count, 0)
  }
}

/** Deletes an upload and its files (the owner or an admin). */
export async function deleteUploadFiles(input: {
  db: Db
  service: Db
  tenantId: string
  uploadId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gone = await input.db.rpc('delete_email_upload', {
    t: input.tenantId,
    upload: input.uploadId
  })
  if (gone.error)
    return {
      ok: false,
      error:
        gone.error.code === '42501'
          ? 'Only the owner or an admin of this workspace can delete emails.'
          : gone.error.hint === 'upload_gone'
            ? 'This email was already deleted.'
            : 'The email was not deleted. Try again in a minute.'
    }
  // Its files, then its row; anything left is the sweep's (`sweepUploads`).
  await removeUpload(input.service, input.uploadId, String(gone.data))
  return { ok: true }
}

/**
 * A `deleting` upload's folder removed, then its row (service role). False
 * when it could not be done now (the sweep tries again).
 */
export async function removeUpload(service: Db, id: string, folder: string) {
  const dir = folder.replace(/\/$/, '')
  const bucket = service.storage.from(uploadBucket)
  const listed = await bucket.list(dir, { limit: 100 })
  if (listed.error) return false
  if (listed.data.length) {
    const removed = await bucket.remove(
      listed.data.map((o) => `${dir}/${o.name}`)
    )
    if (removed.error) return false
  }
  const purged = await service.rpc('purge_email_upload', { upload: id })
  return !purged.error
}
