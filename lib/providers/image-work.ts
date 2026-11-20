/**
 * IMG-ADAPTER (owner picks #4 product cut-outs, #12 smart crop and #15
 * dark-mode-safe pictures): picture work behind one typed adapter, so the
 * design studio asks for it in one way whatever does it later.
 *
 * No service is wired: each of the three jobs needs a vision model or an
 * image service this app does not have (docs/PROJECT_TODOS.md, "Picture
 * work"). The only worker is the fake, and it says so honestly: every job
 * comes back `not_available` with the original picture, never `done`. The
 * original is always kept: a job's result is a new picture beside it,
 * never a replacement.
 */

export type ImageJob = 'cutout' | 'smart_crop' | 'dark_backplate'

export const imageJobs: readonly ImageJob[] = [
  'cutout',
  'smart_crop',
  'dark_backplate'
]

/** The picture a job starts from: the store's own, by its address. */
export type SourcePicture = { url: string }

export type ImageWorkResult =
  /** Done: `result` is the new picture; `original` stays as it was. */
  | { job: ImageJob; status: 'done'; original: string; result: string }
  /** This worker cannot do the job: use the original as it is. */
  | { job: ImageJob; status: 'not_available'; original: string; reason: string }
  /** It tried and failed: use the original as it is. */
  | { job: ImageJob; status: 'failed'; original: string; reason: string }

export interface ImageWorker {
  /** What this worker really does; a job it cannot do is false. */
  readonly can: Readonly<Record<ImageJob, boolean>>
  /** The product alone, on a transparent background (#4). */
  cutOut(picture: SourcePicture): Promise<ImageWorkResult>
  /** Cropped to the box around the product or a face, never cutting it (#12). */
  smartCrop(
    picture: SourcePicture,
    box: { width: number; height: number }
  ): Promise<ImageWorkResult>
  /** A see-through product picture on a plate that reads on dark (#15). */
  darkBackplate(
    picture: SourcePicture,
    plate: { color: string }
  ): Promise<ImageWorkResult>
}

/** Why the fake cannot do each job, in plain words. */
export const notAvailableWords: Record<ImageJob, string> = {
  cutout:
    'Removing a photo’s background needs an image service, and none is set up.',
  smart_crop:
    'Finding the product or a face in a photo needs an image service, and none is set up.',
  dark_backplate:
    'A plate behind a product needs its cut-out first, and cut-outs need an image service.'
}

/** The only worker today: it does nothing and says so. */
export class FakeImageWorker implements ImageWorker {
  readonly can = {
    cutout: false,
    smart_crop: false,
    dark_backplate: false
  } as const

  private notAvailable(job: ImageJob, picture: SourcePicture) {
    return Promise.resolve<ImageWorkResult>({
      job,
      status: 'not_available',
      original: picture.url,
      reason: notAvailableWords[job]
    })
  }

  cutOut(picture: SourcePicture) {
    return this.notAvailable('cutout', picture)
  }
  smartCrop(picture: SourcePicture, box: { width: number; height: number }) {
    void box
    return this.notAvailable('smart_crop', picture)
  }
  darkBackplate(picture: SourcePicture, plate: { color: string }) {
    void plate
    return this.notAvailable('dark_backplate', picture)
  }
}

/**
 * The worker for this server: the fake, whatever `IMAGE_WORK_MODE` says,
 * until a service is chosen (Blocked, needs Raman). A setting that asks
 * for another one is answered with the fake and its reason.
 */
export function imageWorkerFor(env: NodeJS.ProcessEnv = process.env): {
  worker: ImageWorker
  /** Why the fake answers a setting that asked for more; null when asked for it. */
  note: string | null
} {
  const mode = env.IMAGE_WORK_MODE?.trim().toLowerCase()
  return {
    worker: new FakeImageWorker(),
    note:
      !mode || mode === 'fake'
        ? null
        : `IMAGE_WORK_MODE=${mode.slice(0, 20)} is not built: no image service is wired, so pictures stay as they are.`
  }
}

/**
 * A result's address this module accepts: an absolute https URL with no
 * user or password, on a public host name (never localhost, a bare
 * loopback, private or link-local address, or an internal-only name).
 * This is only a first gate: whatever draws the picture into an email
 * still applies its own allowlist (the design studio takes only its own
 * stored files, DST-003b), so a result is never trusted for being https.
 */
export function safeResultUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  if (/[\s"'<>]/.test(value)) return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return false
  if (/\.(?:local|internal|lan|home|corp)$/.test(host) || !host.includes('.'))
    return host.includes(':') ? !privateIpv6(host) : false
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  return true
}

/** Loopback, unique-local, link-local or unspecified IPv6. */
function privateIpv6(host: string) {
  return (
    host === '::1' ||
    host === '::' ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe[89ab][0-9a-f]:/.test(host) ||
    /^::ffff:/.test(host)
  )
}

/**
 * The picture to use after a job: its result when the job asked for is
 * done, for this original, at an address `safeResultUrl` accepts; else
 * the original as it is. Never throws: a worker that throws counts as
 * failed.
 */
export async function pictureAfter(
  run: () => Promise<ImageWorkResult>,
  job: ImageJob,
  original: string
): Promise<{ url: string; result: ImageWorkResult }> {
  let result: ImageWorkResult
  try {
    result = await run()
  } catch {
    result = {
      job,
      status: 'failed',
      original,
      reason: 'The picture work failed, so the original is used.'
    }
  }
  const safe =
    result.status === 'done' &&
    result.job === job &&
    result.original === original &&
    safeResultUrl(result.result)
  return {
    url: safe ? (result as { result: string }).result : original,
    result
  }
}
