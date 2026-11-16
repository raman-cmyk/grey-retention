import { describe, expect, it, vi } from 'vitest'
import { maxNeverWords } from './never-words'
import {
  neverWordsToKeep,
  readNeverWords,
  recordNeverWords
} from './never-words-store'

vi.mock('server-only', () => ({}))

const w = (phrase: string, over: object = {}) => ({
  phrase,
  removed: 3,
  kept: 0,
  instead: ['quiet'],
  ...over
})

describe('the words this brand never uses, kept per workspace (PIC-29 part 2a)', () => {
  it('keeps each phrase once, in the table’s shape, at most a hundred of each', () => {
    const kept = neverWordsToKeep({
      never: [
        w('amazing'),
        w('amazing', { removed: 9 }),
        w(' padded'),
        w('two\nlines'),
        w('bad count', { removed: 0 }),
        w('extra', { note: 'x' } as never),
        42 as never
      ],
      watched: [w('amazing'), w('truly luxurious', { removed: 1, kept: 1 })]
    })
    expect(kept).toEqual({
      never: [w('amazing')],
      watched: [w('truly luxurious', { removed: 1, kept: 1 })]
    })
    const many = Array.from({ length: 150 }, (_, i) => w(`word${i}`))
    expect(neverWordsToKeep({ never: many, watched: [] }).never).toHaveLength(
      maxNeverWords
    )
    expect(neverWordsToKeep(null as never)).toEqual({ never: [], watched: [] })
  })

  it('records the list under the history read’s lease, each with its state', async () => {
    const rpc = vi.fn(async () => ({ data: 2, error: null }))
    const db = { rpc } as never
    expect(
      await recordNeverWords(
        db,
        { id: 'job-1', lease: 'lease-1' },
        { never: [w('amazing')], watched: [w('truly luxurious')] }
      )
    ).toBe(2)
    expect(rpc).toHaveBeenCalledWith('record_never_words', {
      job: 'job-1',
      lease: 'lease-1',
      words: [
        { ...w('amazing'), state: 'never' },
        { ...w('truly luxurious'), state: 'watched' }
      ]
    })
    const failed = { rpc: async () => ({ data: null, error: new Error('x') }) }
    await expect(
      recordNeverWords(
        failed as never,
        { id: 'j', lease: 'l' },
        {
          never: [],
          watched: []
        }
      )
    ).rejects.toThrow('x')
  })

  it('reads the workspace’s own list, never a row of another shape', async () => {
    const asked: unknown[][] = []
    const rows = [
      {
        phrase: 'amazing',
        state: 'never',
        removed: 3,
        kept: 0,
        instead: ['quiet']
      },
      {
        phrase: 'truly luxurious',
        state: 'watched',
        removed: 1,
        kept: 1,
        instead: []
      },
      { phrase: 'odd', state: 'banned', removed: 3, kept: 0, instead: [] },
      { phrase: 'bad', state: 'never', removed: 3, kept: 0, instead: 'x' }
    ]
    const chain = {
      select: (...a: unknown[]) => (asked.push(['select', ...a]), chain),
      eq: (...a: unknown[]) => (asked.push(['eq', ...a]), chain),
      order: () => chain,
      limit: async () => ({ data: rows, error: null })
    }
    const db = { from: (t: string) => (asked.push(['from', t]), chain) }
    expect(await readNeverWords(db as never, 'tenant-1')).toEqual({
      never: [w('amazing')],
      watched: [w('truly luxurious', { removed: 1, kept: 1, instead: [] })]
    })
    expect(asked).toContainEqual(['from', 'brand_never_words'])
    expect(asked).toContainEqual(['eq', 'tenant_id', 'tenant-1'])
  })
})
