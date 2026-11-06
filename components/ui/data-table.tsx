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
    <div className="overflow-x-auto rounded-lg">
      <table className="w-full text-left text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-[var(--line)] bg-[var(--surface-hover)] px-3 py-3 text-xs font-semibold text-[var(--text-muted)]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)] [&>tr]:transition-colors [&>tr:hover]:bg-[var(--surface)]">
          {children}
        </tbody>
      </table>
    </div>
  )
}
