import type { ReactNode } from 'react'
export function DataTable({
  caption,
  headers,
  children
}: {
  caption: string
  headers: string[]
  children: ReactNode
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-[var(--line)] px-3 py-3 font-semibold"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">{children}</tbody>
      </table>
    </div>
  )
}
