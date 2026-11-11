// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { maxPictureBytes, storedPicture } from './pictures'

type Db = Parameters<typeof storedPicture>[0]
const storage = (download: (path: string) => Promise<unknown>) =>
  ({ storage: { from: () => ({ download }) } }) as unknown as Db

describe('storedPicture', () => {
  it('reads a stored picture as a JPEG for the agent', async () => {
    const db = storage(async () => ({
      data: new Blob(['jpeg-bytes']),
      error: null
    }))
    expect(await storedPicture(db, 'sect/a/1.jpg')).toEqual({
      mediaType: 'image/jpeg',
      base64: Buffer.from('jpeg-bytes').toString('base64')
    })
  })

  it('gives nothing without a path, on an error, for a picture too large, or when the download is too slow', async () => {
    const never = vi.fn()
    expect(await storedPicture(storage(never), null)).toBeUndefined()
    expect(never).not.toHaveBeenCalled()
    expect(
      await storedPicture(
        storage(async () => ({ data: null, error: { message: 'x' } })),
        'p'
      )
    ).toBeUndefined()
    expect(
      await storedPicture(
        storage(async () => {
          throw new Error('network')
        }),
        'p'
      )
    ).toBeUndefined()
    expect(
      await storedPicture(
        storage(async () => ({
          data: new Blob([new Uint8Array(maxPictureBytes + 1)]),
          error: null
        })),
        'p'
      )
    ).toBeUndefined()
    const started = Date.now()
    expect(
      await storedPicture(
        storage(() => new Promise(() => {})),
        'p',
        50
      )
    ).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
