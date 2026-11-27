import { describe, expect, it } from 'vitest'
import { samplePage, sampleLookOf, sampleLooks } from './sample'
import { mergeSiteTokens, siteTokens } from './tokens'

const page = (css: string, body = '') =>
  `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`

describe('siteTokens (PICK-006)', () => {
  it('reads the calm sample site exactly', () => {
    const html = samplePage('fernhill.example', '/')!
    expect(sampleLookOf('fernhill.example')).toBe('calm')
    expect(siteTokens(html)).toEqual({
      'spacing.base': 8,
      'spacing.steps': [8, 16, 24, 32, 48],
      'type.body': 16,
      'type.h1': 36,
      'type.h2': 26,
      'type.h3': 20,
      'type.lineHeight': 1.6,
      'type.headingCase': 'uppercase',
      'radius.button': 4,
      'radius.card': 6,
      'radius.image': 6,
      'button.style': 'filled',
      'button.paddingX': 28,
      'button.paddingY': 14,
      'button.case': 'uppercase',
      'button.weight': 600
    })
  })

  it('reads the soft sample site exactly, its pill radius clamped', () => {
    const domain = 'birchwood.example'
    expect(sampleLookOf(domain)).toBe('soft')
    expect(siteTokens(samplePage(domain, '/')!)).toEqual({
      'spacing.base': 6,
      'spacing.steps': [6, 12, 18, 24, 30, 36],
      'type.body': 17,
      'type.h1': 40,
      'type.h2': 28,
      'type.h3': 21,
      'type.lineHeight': 1.5,
      // 999 px on the site: a pill, at most 24 in an email.
      'radius.button': 24,
      'radius.card': 16,
      'radius.image': 12,
      'button.style': 'outline',
      'button.paddingX': 30,
      'button.paddingY': 12,
      'button.weight': 500
    })
  })

  it('is deterministic: the same page always gives the same tokens', () => {
    const html = samplePage('fernhill.example', '/pages/about')!
    expect(siteTokens(html)).toEqual(siteTokens(html))
    expect(Object.keys(sampleLooks)).toEqual(['calm', 'soft'])
  })

  it('reads nothing from a page with no CSS, never a guess', () => {
    expect(siteTokens('<html><body><h1>Hi</h1></body></html>')).toEqual({})
    expect(siteTokens('')).toEqual({})
    expect(siteTokens('<style>{{{{</style>')).toEqual({})
  })

  it('clamps every value to the email-safe range', () => {
    const t = siteTokens(
      page(
        'body{font-size:11px;line-height:2.4}h1{font-size:96px}h2{font-size:8px}h3{font-size:40px}' +
          '.btn{border-radius:60px;padding:2px 90px;font-weight:950}.card{border-radius:-4px}img{border-radius:40px}'
      )
    )
    expect(t['type.body']).toBe(14)
    expect(t['type.lineHeight']).toBe(1.8)
    expect(t['type.h1']).toBe(48)
    expect(t['type.h2']).toBe(18)
    expect(t['type.h3']).toBe(28)
    expect(t['radius.button']).toBe(24)
    expect(t['radius.card']).toBe(0)
    expect(t['radius.image']).toBe(24)
    expect(t['button.paddingY']).toBe(8)
    expect(t['button.paddingX']).toBe(48)
    expect(t['button.weight']).toBe(800)
  })

  it('reads rem at the page root, var(), calc() and clamp()', () => {
    const t = siteTokens(
      page(
        'html{font-size:62.5%}:root{--font-heading-scale:1.2;--buttons-radius:0.6rem;--media-radius:12px}' +
          'body{font-size:1.6rem}h1,.h1{font-size:calc(var(--font-heading-scale) * 3rem)}' +
          'h2,.h2{font-size:clamp(2rem, 4vw, 2.6rem)}.h3{font-size:max(1.8rem, 16px)}'
      )
    )
    expect(t['type.body']).toBe(16)
    expect(t['type.h1']).toBe(36)
    expect(t['type.h2']).toBe(26)
    expect(t['type.h3']).toBe(18)
    expect(t['radius.button']).toBe(6)
    expect(t['radius.image']).toBe(12)
  })

  it('never reads a phone or wide-screen override, a state or a nested selector', () => {
    const t = siteTokens(
      page(
        'h1{font-size:32px}@media (max-width:600px){h1{font-size:24px}}' +
          '@media screen and (min-width:990px){h1{font-size:44px}}' +
          '.footer h1{font-size:20px}h1:hover{font-size:40px}' +
          '.button{background:#000;border-radius:3px}.button:hover{border-radius:20px}' +
          '.button--secondary{border-radius:18px}'
      )
    )
    expect(t['type.h1']).toBe(32)
    expect(t['radius.button']).toBe(3)
    expect(t['button.style']).toBe('filled')
  })

  it('takes the class button over a reset of the button tag', () => {
    const t = siteTokens(
      page(
        'button{background:none;border:0;padding:0;border-radius:0}' +
          '.btn{background-color:#123456;border-radius:10px;padding:16px 36px;text-transform:uppercase}'
      )
    )
    expect(t['button.style']).toBe('filled')
    expect(t['radius.button']).toBe(10)
    expect(t['button.paddingY']).toBe(16)
    expect(t['button.paddingX']).toBe(36)
    expect(t['button.case']).toBe('uppercase')
  })

  it('reads an outline only when there is no fill and a line', () => {
    expect(
      siteTokens(page('.btn{background:transparent;border:1px solid #000}'))[
        'button.style'
      ]
    ).toBe('outline')
    expect(
      siteTokens(page('.btn{background:transparent;border:none}'))[
        'button.style'
      ]
    ).toBeUndefined()
    expect(
      siteTokens(page('.btn{background-color:rgba(0,0,0,0);border-width:2px}'))[
        'button.style'
      ]
    ).toBe('outline')
  })

  it('names a spacing unit only from enough spaces that fit it', () => {
    const fit = siteTokens(
      page(
        '.a{padding:10px 20px}.b{margin:30px 0}.c{gap:40px}.d{padding:20px}.e{margin-bottom:10px}.f{padding:50px}'
      )
    )
    expect(fit['spacing.base']).toBe(10)
    expect(fit['spacing.steps']).toEqual([10, 20, 30, 40, 50])
    // Too few spaces: no unit, never a guess.
    expect(
      siteTokens(page('.a{padding:10px}.b{margin:20px}'))['spacing.base']
    ).toBeUndefined()
    // Spaces that fit no unit well: none.
    expect(
      siteTokens(
        page(
          '.a{padding:7px}.b{margin:13px}.c{gap:17px}.d{padding:23px}.e{margin:29px}.f{gap:31px}'
        )
      )['spacing.base']
    ).toBeUndefined()
  })

  it('reads the stylesheets passed back, after the page', () => {
    const t = siteTokens(page('h1{font-size:30px}'), {
      sheets: [
        {
          url: 'https://shop.example/theme.css',
          css: 'h1{font-size:34px}.card{border-radius:5px}'
        }
      ]
    })
    expect(t['type.h1']).toBe(34)
    expect(t['radius.card']).toBe(5)
  })
})

describe('mergeSiteTokens', () => {
  it('keeps each token from the first page that set it', () => {
    expect(
      mergeSiteTokens([
        { 'type.h1': 30 },
        null,
        { 'type.h1': 40, 'radius.card': 4 }
      ])
    ).toEqual({ 'type.h1': 30, 'radius.card': 4 })
    expect(mergeSiteTokens([])).toEqual({})
  })
})
