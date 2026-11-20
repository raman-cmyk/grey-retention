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
 * The picture to use after a job: its result when done and it is a safe
 * https address, else the original as it is. Never throws: a worker that
 * throws counts as failed.
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
    result.original === original &&
    /^https:\/\/[^\s"'<>]+$/i.test(result.result)
  return {
    url: safe ? (result as { result: string }).result : original,
    result
  }
}
