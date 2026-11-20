// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  FakeImageWorker,
  imageJobs,
  imageWorkerFor,
  notAvailableWords,
  pictureAfter,
  type ImageWorkResult
} from './image-work'

/** IMG-ADAPTER: picture work behind one adapter, honest about what it does. */
const photo = { url: 'https://cdn.shop.example/oak-tray.jpg' }
const env = (values: Record<string, string>) =>
  values as unknown as NodeJS.ProcessEnv

describe('picture work (IMG-ADAPTER, owner picks #4, #12, #15)', () => {
  it('has a fake that can do nothing and says so, keeping the original', async () => {
    const worker = new FakeImageWorker()
    expect(worker.can).toEqual({
      cutout: false,
      smart_crop: false,
      dark_backplate: false
    })
    const results = [
      await worker.cutOut(photo),
      await worker.smartCrop(photo, { width: 600, height: 400 }),
      await worker.darkBackplate(photo, { color: '#1a1a1a' })
    ]
    expect(results.map((r) => [r.job, r.status, r.original])).toEqual(
      imageJobs.map((job) => [job, 'not_available', photo.url])
    )
    for (const r of results) {
      expect(r.status).not.toBe('done')
      expect((r as { reason: string }).reason).toBe(notAvailableWords[r.job])
    }
  })

  it('answers any setting with the fake, saying why when more was asked for', () => {
    expect(imageWorkerFor(env({})).note).toBeNull()
    expect(imageWorkerFor(env({ IMAGE_WORK_MODE: 'fake' })).note).toBeNull()
    const live = imageWorkerFor(env({ IMAGE_WORK_MODE: 'live' }))
    expect(live.worker).toBeInstanceOf(FakeImageWorker)
    expect(live.note).toMatch(/not built: no image service is wired/)
  })

  it('uses the original unless a job is done with a safe picture beside it', async () => {
    const fake = new FakeImageWorker()
    expect(
      (await pictureAfter(() => fake.cutOut(photo), 'cutout', photo.url)).url
    ).toBe(photo.url)
    const done =
      (result: string, original = photo.url) =>
      async () =>
        ({ job: 'cutout', status: 'done', original, result }) as ImageWorkResult
    expect(
      (
        await pictureAfter(
          done('https://cdn.shop.example/oak-tray-cut.png'),
          'cutout',
          photo.url
        )
      ).url
    ).toBe('https://cdn.shop.example/oak-tray-cut.png')
    // Not https, not one address, or another picture's result: the original.
    for (const bad of [
      done('http://cdn.example/x.png'),
      done('https://cdn.example/a.png" onerror="x'),
      done('https://cdn.example/x.png', 'https://cdn.example/other.jpg')
    ])
      expect((await pictureAfter(bad, 'cutout', photo.url)).url).toBe(photo.url)
    // A worker that throws counts as failed, never as done.
    const thrown = await pictureAfter(
      async () => {
        throw new Error('down')
      },
      'smart_crop',
      photo.url
    )
    expect(thrown).toEqual({
      url: photo.url,
      result: {
        job: 'smart_crop',
        status: 'failed',
        original: photo.url,
        reason: 'The picture work failed, so the original is used.'
      }
    })
  })
})
