import { describe, expect, it } from 'vitest'
import { validChatId, validMessageCursor } from './params'

describe('Ask GROS address parameters (UI-ASK)', () => {
  it('keeps only a chat id', () => {
    const id = '00000000-0000-4000-8000-000000000301'
    expect(validChatId(id)).toBe(id)
    for (const bad of [undefined, '', 'chat-1', [id], `${id}x`])
      expect(validChatId(bad)).toBeUndefined()
  })

  it('keeps only a positive whole message cursor', () => {
    expect(validMessageCursor('101')).toBe(101)
    expect(validMessageCursor(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER
    )
    for (const bad of [
      undefined,
      '0',
      '-3',
      '1.5',
      'abc',
      String(Number.MAX_SAFE_INTEGER + 2)
    ])
      expect(validMessageCursor(bad)).toBeUndefined()
  })
})
