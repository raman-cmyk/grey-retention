/**
 * Sidebar state that survives page loads (docs/UI_REBUILD_SPEC.md §2): the
 * collapsed rail and each group's open/closed state. Stored in a small
 * first-party cookie so the server renders the same layout the owner left.
 */
export const shellCookieName = 'gr_shell'

export type ShellState = {
  collapsed: boolean
  groups: Record<string, boolean>
}

const idPattern = /^[a-z][a-z0-9-]{0,31}$/

export function parseShellState(raw: string | undefined | null): ShellState {
  const fallback: ShellState = { collapsed: false, groups: {} }
  if (!raw || raw.length > 1000) return fallback
  try {
    const value: unknown = JSON.parse(decodeURIComponent(raw))
    if (!value || typeof value !== 'object') return fallback
    const record = value as { c?: unknown; g?: unknown }
    const groups: Record<string, boolean> = {}
    if (record.g && typeof record.g === 'object')
      for (const [id, open] of Object.entries(record.g).slice(0, 20))
        if (idPattern.test(id) && typeof open === 'number')
          groups[id] = open === 1
    return { collapsed: record.c === 1, groups }
  } catch {
    return fallback
  }
}

export function serializeShellState(state: ShellState) {
  const g: Record<string, 0 | 1> = {}
  for (const [id, open] of Object.entries(state.groups))
    if (idPattern.test(id)) g[id] = open ? 1 : 0
  return encodeURIComponent(JSON.stringify({ c: state.collapsed ? 1 : 0, g }))
}

export function groupOpen(state: ShellState, id: string, defaultOpen = false) {
  return state.groups[id] ?? defaultOpen
}
