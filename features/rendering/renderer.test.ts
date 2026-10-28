import { it, expect } from 'vitest'
import {
  renderStrip,
  withUtm,
  FixtureLinkValidator,
  FixtureStructureRenderer
} from './renderer'
it('renders original escaped self-contained inspectable strips', () => {
  const r = renderStrip({
    section: 'hero',
    brand: 'Synthetic <brand>',
    subject: '<script>hostile()</script>',
    body: 'Original body',
    cta: 'Explore',
    color: '#123abc',
    font: 'Inter',
    asset: { mediaType: 'image/png', base64: 'fixture' },
    feedback: '<new hero>'
  })
  expect(r.svg).toContain('&lt;script&gt;')
  expect(r.svg).not.toContain('<script>')
  expect(r.svg).toContain('data:image/png;base64,fixture')
  expect(r.svg).not.toContain('https:')
  expect(r.height).toBeGreaterThan(220)
})
it('maps canonical fixture UTMs and validates private brand-domain destinations', async () => {
  const url = withUtm(
    'https://brand.example/p?utm_source=old&variant=one#details',
    'campaign'
  )
  expect(new URL(url).searchParams.getAll('utm_source')).toEqual([
    'grey_retention_fixture'
  ])
  expect(new URL(url).searchParams.get('variant')).toBe('one')
  expect(
    (
      await new FixtureLinkValidator().validate(
        'https://other.example',
        'brand.example'
      )
    ).valid
  ).toBe(false)
  expect(
    (
      await new FixtureLinkValidator().validate(
        'https://user@brand.example',
        'brand.example'
      )
    ).valid
  ).toBe(false)
  expect(
    (await new FixtureLinkValidator().validate(url, 'brand.example')).valid
  ).toBe(true)
})
it('text renderer escapes copy and remains readable without slicing', async () => {
  const r = await new FixtureStructureRenderer().render({
    copyRevision: 2,
    text: 'Original <copy>\nReadable text',
    assetPaths: [],
    structure: []
  })
  expect(r.strips).toEqual([])
  expect(r.html).toContain('Original &lt;copy&gt;')
  expect(r.html).not.toContain('<img')
})
