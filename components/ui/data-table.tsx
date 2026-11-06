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
    <div className="overflow-x-auto rounded-[var(--radius-control)] border border-[var(--line)]">
      <table className="w-full text-left text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className="tracking-label border-b border-[var(--line)] bg-[var(--surface-hover)] px-3 py-2.5 font-mono text-[0.6875rem] font-normal whitespace-nowrap text-[var(--text-muted)] uppercase"
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
