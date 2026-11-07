// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  localDate,
  nextOccurrence,
  ownEntries,
  readEntryForm,
  shortDate
} from './entries'

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}

describe('dates', () => {
  it('finds the next yearly date (29 February becomes 28 February)', () => {
    expect(nextOccurrence('2020-03-14', '2026-11-07')).toBe('2027-03-14')
    expect(nextOccurrence('2020-12-24', '2026-11-07')).toBe('2026-12-24')
    expect(nextOccurrence('2020-11-07', '2026-11-07')).toBe('2026-11-07')
    expect(nextOccurrence('2024-02-29', '2027-01-10')).toBe('2027-02-28')
    expect(nextOccurrence('2024-02-29', '2027-12-01')).toBe('2028-02-29')
    expect(nextOccurrence('2020-01-01', '2026-12-31')).toBe('2027-01-01')
  })

  it('never shows a yearly entry before its own first date', () => {
    expect(nextOccurrence('2027-11-20', '2026-11-07')).toBe('2027-11-20')
    expect(nextOccurrence('2028-02-29', '2026-11-07')).toBe('2028-02-29')
  })

  it('uses the brand’s today and short labels', () => {
    const at = new Date('2026-11-06T20:00:00Z')
    expect(localDate('Asia/Kathmandu', at)).toBe('2026-11-07')
    expect(localDate('US/Pacific', at)).toBe('2026-11-06')
    expect(shortDate('2026-11-11', '2026-11-06')).toBe('Nov 11')
    expect(shortDate('2027-01-01', '2026-11-06')).toBe('Jan 1, 2027')
  })
})

describe('readEntryForm', () => {
  const good = {
    revision: '0',
    name: '  Brand anniversary ',
    date: '2027-03-14',
    kind: 'holiday',
    repeats: 'on',
    notes: 'Tease it early.\r\nBig drop.'
  }
  it('reads a new entry', () => {
    const parsed = readEntryForm(form(good))
    expect(parsed.success && parsed.data).toEqual({
      id: null,
      revision: 0,
      name: 'Brand anniversary',
      date: '2027-03-14',
      kind: 'holiday',
      repeatsAnnually: true,
      notes: 'Tease it early.\nBig drop.'
    })
  })

  it('refuses bad values with plain messages', () => {
    const message = (values: Record<string, string>) => {
      const parsed = readEntryForm(form({ ...good, ...values }))
      return parsed.success ? null : parsed.error.issues[0]?.message
    }
    expect(message({ name: 'X' })).toBe('Name: at least 2 characters.')
    expect(message({ name: 'Drop\nBcc' })).toBe('Name: use one line of text.')
    expect(message({ name: 'Drop\u0085Bcc' })).toBe(
      'Name: use one line of text.'
    )
    expect(message({ name: 'x'.repeat(201) })).toBe(
      'Name: at most 200 characters.'
    )
    expect(message({ date: '1899-12-31' })).toBe(
      'Choose a date between 1900 and 2999.'
    )
    expect(message({ date: '' })).toBe('Choose a date.')
    expect(message({ date: '2027-02-30' })).toBe('Choose a date.')
    expect(message({ kind: 'sale' })).toBe('Choose Holiday or Event.')
    expect(message({ notes: 'x'.repeat(2001) })).toBe(
      'Notes: at most 2000 characters.'
    )
    expect(message({ revision: 'x' })).toBe('Reload the page and try again.')
    // Counted like the database: an emoji is one character.
    expect(message({ name: '🎉' })).toBe('Name: at least 2 characters.')
    expect(message({ name: '🎉'.repeat(200) })).toBeNull()
    expect(message({ notes: '🎉'.repeat(2000) })).toBeNull()
    expect(message({ id: 'not-an-id' })).toMatch(/./)
  })
})

describe('ownEntries', () => {
  const row = (name: string, event_date: string, repeats_annually = false) => ({
    id: name,
    name,
    event_date,
    kind: 'event',
    repeats_annually,
    notes: '',
    revision: 1
  })
  it('lists coming entries first, by their next date, then past ones', () => {
    const list = ownEntries(
      [
        row('Old launch', '2025-01-01'),
        row('Anniversary', '2020-03-14', true),
        row('Studio day', '2026-11-20'),
        row('Founding day', '2019-12-01', true)
      ],
      '2026-11-07'
    )
    expect(list.map((e) => `${e.name} ${e.nextDate}`)).toEqual([
      'Studio day 2026-11-20',
      'Founding day 2026-12-01',
      'Anniversary 2027-03-14',
      'Old launch 2025-01-01'
    ])
  })
})
