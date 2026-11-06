import { describe, expect, it, vi } from 'vitest'
import { subjectFromPaste } from './subject'

vi.mock('server-only', () => ({}))

describe('subjectFromPaste', () => {
  it('uses the HTML title with entities decoded', () => {
    expect(
      subjectFromPaste('<title>Don&#39;t miss &amp; save</title><p>Hi</p>')
    ).toBe("Don't miss & save")
  })

  it('falls back to the first readable line', () => {
    expect(subjectFromPaste('\n\n  Free shipping today  \nMore text')).toBe(
      'Free shipping today'
    )
    expect(subjectFromPaste('<ul><li>First item</li></ul>')).toBe('First item')
  })

  it('ignores invisible-only titles and strips controls', () => {
    expect(subjectFromPaste('<title>​‮</title><p>Real line</p>')).toBe(
      'Real line'
    )
    expect(subjectFromPaste('Sale‮ today')).toBe('Sale today')
    expect(subjectFromPaste('<img src="x">')).toBe('Pasted email')
  })

  it('never splits an emoji at the length limit', () => {
    const subject = subjectFromPaste(`<title>${'😀'.repeat(250)}</title>`)
    expect(subject.length).toBeLessThanOrEqual(200)
    expect(subject.isWellFormed()).toBe(true)
    expect(subject.endsWith('…')).toBe(true)
  })

  it('stays fast on hostile input', () => {
    const hostile = '<title'.repeat(200_000)
    const started = performance.now()
    subjectFromPaste(hostile)
    expect(performance.now() - started).toBeLessThan(500)
  })
})
