// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { localTime, readDefaultsForm, timezoneLabel } from './defaults'

const product = '00000000-0000-4000-8000-000000000301'
function form(values: Record<string, string | string[]>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values))
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v)
  return data
}

describe('readDefaultsForm', () => {
  it('reads every tab from one form', () => {
    const parsed = readDefaultsForm(
      form({
        revision: '2',
        featured_product: product,
        sender_name: '  Cedar Lane ',
        primary_link: ' https://cedar-lane.example/new ',
        send_to: ['list_1', 'seg_2'],
        dont_send_to: 'seg_9',
        include_footer: 'on',
        footer_source: 'auto'
      })
    )
    expect(parsed.success && parsed.data).toEqual({
      featuredProductId: product,
      senderName: 'Cedar Lane',
      primaryLink: 'https://cedar-lane.example/new',
      sendTo: ['list_1', 'seg_2'],
      dontSendTo: ['seg_9'],
      includeFooter: true,
      footerSource: 'auto',
      revision: 2
    })
  })

  it('treats blanks as "no default" and an unticked box as no footer', () => {
    const parsed = readDefaultsForm(form({ revision: '0' }))
    expect(parsed.success && parsed.data).toMatchObject({
      featuredProductId: null,
      senderName: '',
      primaryLink: '',
      sendTo: [],
      dontSendTo: [],
      includeFooter: false
    })
  })

  it('refuses bad values with plain messages', () => {
    const message = (values: Record<string, string | string[]>) => {
      const parsed = readDefaultsForm(form({ revision: '0', ...values }))
      return parsed.success ? null : parsed.error.issues[0]?.message
    }
    expect(message({ primary_link: 'http://cedar-lane.example' })).toBe(
      'Primary link: use a full address that starts with https://'
    )
    expect(message({ primary_link: 'cedar-lane.example' })).toMatch(/https:/)
    expect(message({ sender_name: 'x'.repeat(101) })).toBe(
      'Sender name: at most 100 characters.'
    )
    expect(message({ featured_product: 'not-a-product' })).toBe(
      'Choose a product from the list.'
    )
    expect(message({ send_to: ['a', 'a'] })).toBe(
      'Send to: each list or segment once.'
    )
    expect(message({ send_to: 'a', dont_send_to: 'a' })).toBe(
      'A list or segment cannot be in both Send to and Don’t send to.'
    )
    expect(
      message({ send_to: Array.from({ length: 21 }, (_, i) => `id${i}`) })
    ).toBe('Send to: choose at most 20 lists or segments.')
    expect(message({ footer_source: 'template:1' })).toBe(
      'Choose the automatic footer.'
    )
  })

  it('marks a missing or broken revision', () => {
    const parsed = readDefaultsForm(form({ revision: 'x' }))
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(
      'Reload the page and try again.'
    )
  })
})

describe('timezone display', () => {
  const at = new Date('2026-11-06T17:07:00Z')

  it('shows the zone with its current UTC offset', () => {
    expect(timezoneLabel('US/Pacific', at)).toBe('US/Pacific (UTC-08:00)')
    expect(timezoneLabel('Asia/Kathmandu', at)).toBe(
      'Asia/Kathmandu (UTC+05:45)'
    )
    expect(timezoneLabel('UTC', at)).toBe('UTC (UTC+00:00)')
    expect(timezoneLabel('US/Pacific', new Date('2026-07-01T12:00:00Z'))).toBe(
      'US/Pacific (UTC-07:00)'
    )
  })

  it('shows the local time like the old app', () => {
    expect(localTime('US/Pacific', at)).toBe('Fri, Nov 6 2026 · 9:07 AM')
    expect(localTime('Australia/Melbourne', at)).toBe(
      'Sat, Nov 7 2026 · 4:07 AM'
    )
  })
})
