export function WorkspaceLoading() {
  return (
    <div
      className="mx-auto max-w-6xl"
      role="status"
      aria-label="Loading workspace"
    >
      <p className="sr-only">Loading workspace…</p>
      <div aria-hidden className="space-y-6">
        <div className="h-8 w-56 rounded-lg bg-[var(--line)]" />
        <div className="h-4 w-3/4 max-w-xl rounded bg-[var(--line)]" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-6">
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="flex items-center gap-4 border-b border-[var(--line)] py-6 last:border-0"
              >
                <div className="size-10 rounded-lg bg-[var(--surface-hover)]" />
                <div className="flex-1 space-y-3">
                  <div className="h-4 w-2/3 rounded bg-[var(--surface-hover)]" />
                  <div className="h-3 w-1/3 rounded bg-[var(--surface-hover)]" />
                </div>
              </div>
            ))}
          </div>
          <div className="h-56 rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)]" />
        </div>
      </div>
    </div>
  )
}
