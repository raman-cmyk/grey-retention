import { expect, it, vi } from 'vitest'
import { readPages } from './read-pages'

it('reads through scoped pages, including an exact full-page boundary', async () => {
  const rows = [{ id: 'one' }, { id: 'two' }, { id: 'three' }, { id: 'four' }]
  const query = vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, to + 1),
    error: null
  }))
  expect(await readPages(query, 2)).toEqual({ data: rows, error: null })
  expect(query.mock.calls).toEqual([
    [0, 1],
    [2, 3],
    [4, 5]
  ])
})

it('fails the full read when a later page is denied instead of exposing a partial collection', async () => {
  const denied = { code: '42501' }
  const query = vi.fn(async (from: number) =>
    from === 0
      ? { data: [{ id: 'one' }, { id: 'two' }], error: null }
      : { data: null, error: denied }
  )
  expect(await readPages(query, 2)).toEqual({ data: null, error: denied })
  expect(query).toHaveBeenCalledTimes(2)
})

it('handles an empty collection and rejects a page size that cannot make progress', async () => {
  const query = vi.fn(async () => ({ data: [], error: null }))
  expect(await readPages(query)).toEqual({ data: [], error: null })
  await expect(readPages(query, 0)).rejects.toThrow(RangeError)
})
