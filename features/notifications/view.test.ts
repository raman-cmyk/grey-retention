import { describe, expect, it } from 'vitest'
import { noticeList, safeNoticeHref, type NoticeRow } from './view'

const row = (over: Partial<NoticeRow>): NoticeRow => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  kind: 'drafts_ready',
  message: '12 of 15 drafts are in Klaviyo',
  href: '/plan',
  read_at: null,
  updated_at: '2026-11-27T03:22:00.000Z',
  ...over
})

describe('noticeList (PICK-107)', () => {
  it('shows each notice as one line with its link, store time and whether it is new', () => {
    const { items, unread } = noticeList(
      [
        row({}),
        row({
          id: '00000000-0000-4000-8000-0000000000a2',
          kind: 'results_in',
          message: 'Results are in for the Tuesday, Dec 1 email',
          href: '/plan/email/00000000-0000-4000-8000-00000000b901',
          read_at: '2026-11-27T04:00:00.000Z'
        })
      ],
      'Asia/Kathmandu'
    )
    expect(items).toEqual([
      {
        id: '00000000-0000-4000-8000-0000000000a1',
        kind: 'drafts_ready',
        line: '12 of 15 drafts are in Klaviyo',
        href: '/plan',
        unread: true,
        at: 'Nov 27, 2026 · 9:07 AM'
      },
      {
        id: '00000000-0000-4000-8000-0000000000a2',
        kind: 'results_in',
        line: 'Results are in for the Tuesday, Dec 1 email',
        href: '/plan/email/00000000-0000-4000-8000-00000000b901',
        unread: false,
        at: 'Nov 27, 2026 · 9:07 AM'
      }
    ])
    expect(unread).toBe(1)
  })

  it('leaves out other kinds of notice (the old review and budget notices)', () => {
    expect(
      noticeList([row({ kind: 'budget_soft_alert' })], 'UTC').items
    ).toEqual([])
  })
})

describe('safeNoticeHref', () => {
  it('opens only a page of this app, else the plan', () => {
    expect(safeNoticeHref('/plan/email/abc-1')).toBe('/plan/email/abc-1')
    for (const bad of [
      null,
      undefined,
      '',
      'https://example.com',
      '//example.com',
      '/plan//x',
      '/plan?x=1',
      'javascript:alert(1)'
    ])
      expect(safeNoticeHref(bad)).toBe('/plan')
  })
})
