type ReadPageResult<T, E> = { data: T[] | null; error: E | null }

// Callers supply a scoped query with a stable, unique ordering for every page.
export async function readPages<T, E>(
  query: (from: number, to: number) => PromiseLike<ReadPageResult<T, E>>,
  pageSize = 500
): Promise<ReadPageResult<T, E>> {
  if (!Number.isInteger(pageSize) || pageSize < 1)
    throw new RangeError('Page size must be a positive integer.')
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const page = await query(from, from + pageSize - 1)
    if (page.error) return { data: null, error: page.error }
    const records = page.data ?? []
    rows.push(...records)
    if (records.length < pageSize) return { data: rows, error: null }
  }
}
