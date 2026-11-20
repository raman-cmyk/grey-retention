// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  FakeImageWorker,
  imageJobs,
  imageWorkerFor,
  notAvailableWords,
  pictureAfter,
  safeResultUrl,
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

  it('falls back to the original for a done result of another job, or at an unsafe address', async () => {
    const done =
      (result: string, job: ImageWorkResult['job'] = 'cutout') =>
      async () =>
        ({
          job,
          status: 'done',
          original: photo.url,
          result
        }) as ImageWorkResult
    const good = 'https://cdn.shop.example/oak-tray-cut.png'
    // A done result for another job than the one asked for.
    expect(
      (await pictureAfter(done(good, 'smart_crop'), 'cutout', photo.url)).url
    ).toBe(photo.url)
    for (const bad of [
      'not a url',
      'https://',
      'https://user:pass@cdn.example/x.png',
      'https://user@cdn.example/x.png',
      'https://127.0.0.1/x.png',
      'https://2130706433/x.png',
      'https://10.1.2.3/x.png',
      'https://172.16.0.9/x.png',
      'https://192.168.1.4/x.png',
      'https://169.254.169.254/latest',
      'https://localhost/x.png',
      'https://studio.localhost/x.png',
      'https://[::1]/x.png',
      'https://[fe80::1]/x.png',
      'https://[fd00::1]/x.png',
      'https://[::ffff:127.0.0.1]/x.png',
      'https://intranet/x.png',
      'https://files.internal/x.png',
      'ftp://cdn.example/x.png'
    ]) {
      expect(safeResultUrl(bad), bad).toBe(false)
      expect(
        (await pictureAfter(done(bad), 'cutout', photo.url)).url,
        bad
      ).toBe(photo.url)
    }
    expect(safeResultUrl(good)).toBe(true)
    expect(safeResultUrl('https://[2606:4700::1111]/x.png')).toBe(true)
  })
})
