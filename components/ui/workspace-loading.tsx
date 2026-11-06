/**
 * Loading state from docs/DESIGN.md: quiet hairline skeleton blocks on the
 * sunken canvas. No spinner for whole pages and no fake progress.
 */
function Block({ className }: { className: string }) {
  return (
    <div
      className={`rounded-[var(--radius-control)] bg-[var(--surface-hover)] motion-safe:animate-pulse ${className}`}
    />
  )
}

export function WorkspaceLoading() {
  return (
    <div role="status" aria-label="Loading workspace">
      <p className="sr-only">Loading workspace…</p>
      <div aria-hidden className="space-y-7">
        <div className="space-y-3">
          <Block className="h-9 w-64 max-w-full" />
          <Block className="h-4 w-3/4 max-w-xl" />
        </div>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3">
          {[1, 2, 3].map((tile) => (
            <div
              key={tile}
              className="space-y-3 bg-[var(--surface-raised)] p-6"
            >
              <Block className="h-3 w-24" />
              <Block className="h-9 w-14" />
            </div>
          ))}
        </div>
        <div className="rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] px-6">
          {[1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="flex items-center gap-4 border-b border-[var(--line)] py-5 last:border-0"
            >
              <Block className="size-10 shrink-0" />
              <div className="flex-1 space-y-2.5">
                <Block className="h-4 w-2/3" />
                <Block className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
