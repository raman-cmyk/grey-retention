// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { sweepUploads } = await import('./jobs')

describe('the upload sweep (DES-ENGINE-003a)', () => {
  it('removes a deleted upload’s files then its row, and folders with no upload', async () => {
    const t = '00000000-0000-4000-8000-0000000000d1'
    const gone = '00000000-0000-4000-8000-0000000000c2'
    const kept = '00000000-0000-4000-8000-0000000000c3'
    const orphan = '00000000-0000-4000-8000-0000000000c4'
    const calls: string[] = []
    const folders: Record<string, string[]> = {
      '': [t, 'not-a-workspace'],
      [t]: [gone, kept, orphan],
      [`${t}/${gone}`]: ['original.eml', 'email.html'],
      [`${t}/${kept}`]: ['original.eml'],
      [`${t}/${orphan}`]: ['original.html']
    }
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push(`${fn}:${JSON.stringify(args)}`)
        return fn === 'email_uploads_to_clean'
          ? { data: [{ id: gone, folder: `${t}/${gone}/` }], error: null }
          : { data: true, error: null }
      },
      from: () => ({
        select: () => ({
          in: async (_: string, ids: string[]) => ({
            data: ids.filter((i) => i !== orphan).map((id) => ({ id })),
            error: null
          })
        })
      }),
      storage: {
        from: () => ({
          list: async (dir: string) => ({
            data: (folders[dir] ?? []).map((name) => ({ name })),
            error: null
          }),
          remove: async (paths: string[]) => {
            calls.push(`remove:${paths.join(',')}`)
            return { data: [], error: null }
          }
        })
      }
    }
    expect(await sweepUploads(db as never, () => 0)).toEqual({
      removed: 1,
      leftovers: 1
    })
    expect(calls).toEqual([
      'email_uploads_to_clean:{"n":20}',
      `remove:${t}/${gone}/original.eml,${t}/${gone}/email.html`,
      `purge_email_upload:{"upload":"${gone}"}`,
      `remove:${t}/${orphan}/original.html`
    ])
  })
})
