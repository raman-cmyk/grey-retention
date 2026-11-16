// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { memoryFallbackLog } from '@/features/fallback/log'
import { buildEmail, type PlannedEmail } from './build'
import { hardProblems } from './hard-checks'
import { sampleOffers, sampleStoreSource } from './ports'

/** DST-005 part 1: the hard checks on the email as drawn. */
const tenant = '00000000-0000-4000-8000-000000000101'
const inDays = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const planned: PlannedEmail = {
  date: inDays(2),
  time: '10:00',
  emailType: 'launch',
  angle: 'Meet the linen throw',
  products: [{ id: 'p-linen-throw', title: 'Linen throw' }],
  offer: null,
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
}
const built = async () => {
  const made = await buildEmail(
    {
      planned,
      store: await sampleStoreSource.read(tenant),
      offers: sampleOffers
    },
    { tenantId: tenant, callerKey: 'x', fallbacks: memoryFallbackLog() }
  )
  if (!made.ok) throw new Error('sample build failed')
  return made.email.html
}
const rules = { maxDiscountPercent: 20 }
const checks = (html: string, max = 20) =>
  hardProblems(html, { maxDiscountPercent: max }).map((p) => p.check)
const add = (html: string, more: string) =>
  html.replace('</body>', `${more}</body>`)

describe('the hard checks on a drawn email (DST-005)', () => {
  it('pass an email the build draws', async () => {
    expect(hardProblems(await built(), rules)).toEqual([])
  })

  it('refuse an email Gmail would cut off', async () => {
    const html = add(await built(), `<p>${'x'.repeat(110 * 1024)}</p>`)
    expect(hardProblems(html, rules)).toEqual([
      expect.objectContaining({
        check: 'weight',
        problem: expect.stringMatching(/Gmail cuts off emails over 102 KB/)
      })
    ])
  })

  it('refuse anything wider than the email', async () => {
    const html = await built()
    expect(
      checks(add(html, '<table width="700"><tr><td>x</td></tr></table>'))
    ).toEqual(['width'])
    expect(checks(add(html, '<div style="width:640px">x</div>'))).toEqual([
      'width'
    ])
    expect(checks(add(html, '<div style="max-width:640px">x</div>'))).toEqual(
      []
    )
  })

  it('refuse a picture with no words for when pictures are off', async () => {
    const html = await built()
    expect(
      checks(add(html, '<img src="https://cdn.shop.example/a.jpg" alt="">'))
    ).toEqual(['alt'])
    expect(
      checks(add(html, '<img src="https://cdn.shop.example/a.jpg">'))
    ).toEqual(['alt'])
  })

  it('refuse a link that is empty, # or not https, and an email with no link to the store', async () => {
    const html = await built()
    for (const href of [
      '#',
      '',
      'http://shop.example/a',
      'javascript:alert(1)'
    ])
      expect(checks(add(html, `<a href="${href}">x</a>`))).toEqual(['links'])
    // Mail and Klaviyo's own tags are fine.
    expect(
      checks(add(html, '<a href="mailto:hello@shop.example">Write</a>'))
    ).toEqual([])
    const none = html.replace(/href="https:[^"]*"/g, 'href="mailto:a@b.co"')
    expect(hardProblems(none, rules).map((p) => p.problem)).toContain(
      'The email has no link to the store.'
    )
  })

  it('refuse an email without Klaviyo’s footer tags', async () => {
    const html = (await built()).replace(/\{%\s*unsubscribe[^%]*%\}/g, '')
    expect(hardProblems(html, rules)).toEqual(
      expect.arrayContaining([
        { check: 'footer', problem: 'The unsubscribe link is missing.' }
      ])
    )
  })

  it('refuse a percent off over the max, drawn or in a picture’s words, never a fabric', async () => {
    const html = await built()
    expect(checks(add(html, '<p>Save 40% today</p>'))).toEqual(['offer'])
    expect(checks(add(html, '<p>40% off everything</p>'))).toEqual(['offer'])
    expect(
      checks(
        add(
          html,
          '<img src="https://cdn.shop.example/a.jpg" alt="Up to 35% on throws">'
        )
      )
    ).toEqual(['offer'])
    expect(checks(add(html, '<p>Save 20% today</p>'))).toEqual([])
    expect(checks(add(html, '<p>100% linen, made to last</p>'))).toEqual([])
    // With no discount allowed, any offer is refused.
    expect(checks(add(html, '<p>Save 5%</p>'), 0)).toEqual(['offer'])
    expect(hardProblems(add(html, '<p>Save 40%</p>'), rules)[0]!.problem).toBe(
      'The email shows 40%, over your max of 20%.'
    )
  })

  it('read an offer as copy QA does: product names and approved claims are no offer, every other way of writing one is', async () => {
    const html = await built()
    const known = [
      'Up to 60% recycled fibres',
      'Up to 60 percent recycled fibres',
      'Get 100% organic cotton',
      'Bundle (30% off)'
    ]
    const offer = (more: string, max = 20) =>
      hardProblems(add(html, more), { maxDiscountPercent: max, known }).map(
        (p) => p.check
      )
    expect(offer('<p>Made with up to 60% recycled fibres.</p>')).toEqual([])
    expect(
      offer('<p>Up to 60 percent recycled fibres in every throw.</p>')
    ).toEqual([])
    expect(offer('<p>Save 40 per cent today</p>')).toEqual(['offer'])
    expect(offer('<p>Get 100% organic cotton in every throw.</p>')).toEqual([])
    expect(offer('<p>Bundle (30% off) is back</p>')).toEqual([])
    for (const drawn of [
      '<p>40 percent off</p>',
      '<p>40％ off</p>',
      '<p>4\u200b0% off</p>',
      '<p>Extra 40%</p>',
      '<p>The 40% sale</p>',
      '<p>Now -40%</p>',
      '<p>40%-off</p>',
      '<p>40&percnt; off</p>'
    ])
      expect(offer(drawn)).toEqual(['offer'])
    expect(offer('<p>Take 12.5% off</p>', 10)).toEqual(['offer'])
    expect(offer('<p>Take 10% off</p>', 10)).toEqual([])
  })

  it('want a link to the store itself when its hosts are known', async () => {
    const html = await built()
    const away = html.replace(
      /href="https:\/\/[^"/]+/g,
      'href="https://elsewhere.example'
    )
    const storeHosts = ['cedar-lane.example']
    expect(
      hardProblems(away, { maxDiscountPercent: 20, storeHosts }).map(
        (p) => p.problem
      )
    ).toContain('The email has no link to the store.')
    expect(hardProblems(html, { maxDiscountPercent: 20, storeHosts })).toEqual(
      []
    )
  })

  it('leave room for Klaviyo’s links under Gmail’s limit, and read widths in the markup only', async () => {
    const html = await built()
    expect(checks(add(html, `<p>${'x'.repeat(95 * 1024)}</p>`))).toEqual([
      'weight'
    ])
    expect(checks(add(html, '<p>Set width: 700px on the box.</p>'))).toEqual([])
  })
})
