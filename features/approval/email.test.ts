import { describe, expect, it, vi } from 'vitest'
import { stillOpen, weeklyApprovalEmail, type ApprovalEmailItem } from './email'

const now = new Date('2026-11-08T09:00:00Z')
const item = (
  id: string,
  over: Partial<ApprovalEmailItem> = {}
): ApprovalEmailItem => ({
  campaignId: id,
  revision: 1,
  sendAt: '2026-11-10T08:00:00Z',
  subject: `Email ${id}`,
  offer: null,
  segment: 'Engaged 90 days',
  state: 'pending_approval',
  changeRounds: 0,
  edited: false,
  warnings: [],
  ...over
})
type Input = Parameters<typeof weeklyApprovalEmail>[0]
const email = (items: ApprovalEmailItem[], over: Partial<Input> = {}) =>
  weeklyApprovalEmail({
    brandName: 'Example Co',
    weekLabel: 'the week of 10 November',
    timezone: 'Asia/Kathmandu',
    items,
    now,
    linksExpireAt: '2026-11-15T09:00:00Z',
    approveAllUrl: () => 'https://app.example/approve/token-all',
    changeUrl: (i) => `https://app.example/change/token-${i.campaignId}`,
    ...over
  })

describe('the weekly approval email', () => {
  it('lists the emails still open, soonest first, with date, offer and audience', () => {
    const out = email([
      item('sun', {
        sendAt: '2026-11-15T08:00:00Z',
        offer: '15% off with WELCOME15'
      }),
      item('tue'),
      item('done', { state: 'approved' }),
      item('gone', { sendAt: '2026-11-08T08:00:00Z' }),
      item('soon', { sendAt: '2026-11-08T09:30:00Z' })
    ])
    expect(out.subject).toBe(
      '2 emails for the week of 10 November: approve or change'
    )
    expect(out.html.indexOf('Email tue')).toBeLessThan(
      out.html.indexOf('Email sun')
    )
    for (const left of ['done', 'gone', 'soon'])
      expect(out.html).not.toContain(`Email ${left}`)
    expect(out.html).toContain('Offer: 15% off with WELCOME15')
    expect(out.html).toContain('Sends to: Engaged 90 days')
    expect(out.html).toContain('Kathmandu')
    expect(out.text).toContain(
      'Approve all: https://app.example/approve/token-all'
    )
    expect(out.text).toContain('Change: https://app.example/change/token-tue')
  })

  it('signs Approve all for exactly the emails shown, and each Change link once', () => {
    const approveAllUrl = vi.fn(() => 'https://app.example/approve/all')
    const changeUrl = vi.fn(
      (i: ApprovalEmailItem) => `https://app.example/change/${i.campaignId}`
    )
    const out = email(
      [
        item('a', { revision: 3 }),
        item('b'),
        item('old', { sendAt: '2026-11-08T08:00:00Z' })
      ],
      { approveAllUrl, changeUrl }
    )
    const shown = [
      { campaignId: 'a', revision: 3 },
      { campaignId: 'b', revision: 1 }
    ]
    expect(out.shown).toEqual(shown)
    expect(approveAllUrl).toHaveBeenCalledExactlyOnceWith(shown)
    expect(changeUrl).toHaveBeenCalledTimes(2)
    expect(out.html).toContain('href="https://app.example/change/a"')
    expect(out.text).toContain('Change: https://app.example/change/a')
  })

  it('is not sent when nothing is waiting', () => {
    expect(() => email([item('a', { state: 'approved' })])).toThrow(
      /Nothing is waiting/
    )
    expect(stillOpen([item('a', { sendAt: 'never' })], now)).toEqual([])
  })

  it('shows the phone screenshot and every warning to check', () => {
    const out = email([
      item('a', {
        screenshotUrl: 'https://cdn.example/a-375.png',
        warnings: ['This picture may have claims printed on it.']
      })
    ])
    expect(out.html).toContain('src="https://cdn.example/a-375.png"')
    expect(out.html).not.toContain('float:')
    expect(out.html).toContain(
      'Check: This picture may have claims printed on it.'
    )
  })

  it('escapes every word', () => {
    const out = email(
      [
        item('x', {
          subject: '<script>alert(1)</script>',
          offer: '<b>50%</b>',
          segment: '<i>VIP</i>',
          warnings: ['<img src=x onerror=alert(1)>']
        })
      ],
      { brandName: '<Brand & Co>' }
    )
    for (const raw of ['<script>', '<b>50%', '<i>VIP', '<img src=x', '<Brand'])
      expect(out.html).not.toContain(raw)
    expect(out.html).toContain('&lt;Brand &amp; Co&gt;')
  })

  it('refuses links that are not clean https, and drops other pictures', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://app.example/a',
      'https://app.example/a\nBcc: y',
      'https://user:pass@app.example/a'
    ]) {
      expect(() => email([item('a')], { approveAllUrl: () => url })).toThrow(
        /https/
      )
      expect(() => email([item('a')], { changeUrl: () => url })).toThrow(
        /https/
      )
    }
    const http = email([
      item('y', { screenshotUrl: 'http://cdn.example/y.png' })
    ])
    expect(http.html).not.toContain('http://cdn.example')
  })

  it('keeps the subject on one line', () => {
    const out = email([item('a')], { weekLabel: 'this week\r\nBcc: x' })
    expect(out.subject).toBe('1 email for this week Bcc: x: approve or change')
  })

  it('has a preheader, says when links stop working, and promises nothing it cannot do', () => {
    const out = email([item('a')])
    expect(out.preheader).toMatch(/Nothing is sent until you approve/)
    expect(out.html).toContain('display:none')
    expect(out.html).toMatch(/These links work until .*Kathmandu.*works once/)
    expect(out.text).toContain('Nothing is sent until you approve.')
    expect(`${out.html}${out.text}`).not.toMatch(/reply/i)
  })

  it('uses padded links as buttons, so they are easy to tap on a phone', () => {
    const out = email([item('a')])
    expect(out.html).toMatch(
      /<a href="[^"]+" style="display:inline-block;padding:14px 24px/
    )
  })
})
