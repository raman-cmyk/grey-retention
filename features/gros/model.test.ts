import { describe, expect, it } from 'vitest'
import {
  agoText,
  firstName,
  greeting,
  isSendKey,
  threadMeta,
  validChatId,
  validMessageCursor
} from './model'

const now = Date.parse('2026-11-07T12:00:00Z')
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString()

describe('GROS model', () => {
  it('greets the viewer by first name, honestly about sample data', () => {
    expect(firstName('Demo Owner')).toBe('Demo')
    expect(firstName('  ')).toBe('there')
    expect(firstName(null)).toBe('there')
    const text = greeting('Demo')
    expect(text).toMatch(/^Hi Demo — I'm GROS, your marketing assistant\./)
    expect(text).toContain('sample data for now')
    expect(text).toMatch(/What's on your mind\?$/)
  })

  it('says how long ago a chat was used', () => {
    expect(agoText(daysAgo(0), now)).toBe('today')
    expect(agoText(daysAgo(1), now)).toBe('yesterday')
    expect(agoText(daysAgo(46), now)).toBe('46 days ago')
    expect(agoText(daysAgo(90), now)).toBe('3 months ago')
    expect(agoText(daysAgo(800), now)).toBe('2 years ago')
    // A clock slightly ahead never says "-1 days".
    expect(agoText(new Date(now + 60_000).toISOString(), now)).toBe('today')
  })

  it('shows "5 msg · 46 days ago", falling back to when the chat began', () => {
    expect(
      threadMeta(
        {
          message_count: 5,
          last_message_at: daysAgo(46),
          created_at: daysAgo(50)
        },
        now
      )
    ).toBe('5 msg · 46 days ago')
    expect(
      threadMeta(
        { message_count: 0, last_message_at: null, created_at: daysAgo(2) },
        now
      )
    ).toBe('0 msg · 2 days ago')
  })

  it('sends on ⌘+Enter or Ctrl+Enter only, never while composing', () => {
    const key = (over: Partial<Parameters<typeof isSendKey>[0]>) =>
      isSendKey({ key: 'Enter', metaKey: false, ctrlKey: false, ...over })
    expect(key({ metaKey: true })).toBe(true)
    expect(key({ ctrlKey: true })).toBe(true)
    expect(key({})).toBe(false)
    expect(key({ key: 'a', ctrlKey: true })).toBe(false)
    expect(key({ ctrlKey: true, isComposing: true })).toBe(false)
    expect(key({ metaKey: true, keyCode: 229 })).toBe(false)
  })

  it('accepts only real chat ids and positive cursors', () => {
    expect(validChatId('00000000-0000-4000-8000-000000000901')).toBe(
      '00000000-0000-4000-8000-000000000901'
    )
    expect(validChatId('thread-1')).toBeUndefined()
    expect(validMessageCursor('51')).toBe(51)
    for (const bad of ['0', '-1', '1.5', 'x', undefined])
      expect(validMessageCursor(bad)).toBeUndefined()
  })
})
