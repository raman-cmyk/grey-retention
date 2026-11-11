import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { AiImage } from '@/lib/providers/contracts'

/** A picture larger than this is not sent to the agents. */
export const maxPictureBytes = 1_500_000
/**
 * The longest a stored picture may take to download. Past it the agent
 * works without the picture, so a slow download never stretches a run
 * past its time limit (CI-003's 60 seconds).
 */
export const pictureTimeoutMs = 3_000

/**
 * A stored picture (a section crop or the screenshot) for an agent call,
 * or nothing when there is none, it cannot be read in time, or it is too
 * large.
 */
export async function storedPicture(
  db: SupabaseClient<Database>,
  path: string | null,
  timeoutMs = pictureTimeoutMs
): Promise<AiImage | undefined> {
  if (!path) return undefined
  const download = (async (): Promise<AiImage | undefined> => {
    const { data, error } = await db.storage.from('inbox-assets').download(path)
    if (error || !data || data.size > maxPictureBytes) return undefined
    return {
      mediaType: 'image/jpeg',
      base64: Buffer.from(await data.arrayBuffer()).toString('base64')
    }
  })().catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs)
  })
  try {
    return await Promise.race([download, late])
  } finally {
    clearTimeout(timer)
  }
}
