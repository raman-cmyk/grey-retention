import { describe, expect, it } from 'vitest'
import { groupOpen, parseShellState, serializeShellState } from './shell-state'

describe('shell state cookie', () => {
  it('round-trips collapse and group state', () => {
    const state = {
      collapsed: true,
      groups: { agents: true, workspace: false }
    }
    expect(parseShellState(serializeShellState(state))).toEqual(state)
  })

  it('falls back safely on missing, broken or oversized values', () => {
    const empty = { collapsed: false, groups: {} }
    expect(parseShellState(undefined)).toEqual(empty)
    expect(parseShellState('%7Bnot json')).toEqual(empty)
    expect(parseShellState('x'.repeat(2000))).toEqual(empty)
    expect(parseShellState(encodeURIComponent('[1,2]'))).toEqual(empty)
  })

  it('ignores unexpected group ids and values', () => {
    const raw = encodeURIComponent(
      JSON.stringify({ c: 1, g: { agents: 1, 'Bad Id': 1, more: 'yes' } })
    )
    expect(parseShellState(raw)).toEqual({
      collapsed: true,
      groups: { agents: true }
    })
  })

  it('uses the group default until the owner chooses', () => {
    expect(groupOpen({ collapsed: false, groups: {} }, 'workspace', true)).toBe(
      true
    )
    expect(
      groupOpen(
        { collapsed: false, groups: { workspace: false } },
        'workspace',
        true
      )
    ).toBe(false)
  })
})
