// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderEmail } from '@/features/blocks/render'
import { sampleBlocks, sampleBrand } from '@/features/blocks/samples'
import { renderLetter } from '@/features/letter/render'
import { letterSchema } from '@/features/letter/letter'
import { memoryFallbackLog } from '@/features/fallback/log'
import { accessibilityProblems, faintText } from './accessibility'
import { goldenBriefs } from './golden/briefs'
import { runGolden } from './golden/run'
import { hardProblems } from './hard-checks'

/** Owner pick #96: accessibility on every email, as drawn. */
const page = (body: string, head = '<title>Meet the throw</title>') =>
  `<!doctype html><html lang="en"><head>${head}</head><body style="margin:0"><table role="presentation"><tr><td>${body}</td></tr></table></body></html>`
const ok =
  '<h1>Meet the throw</h1><p>Soft linen, made by hand.</p><a href="https://shop.example">Shop the throw</a>'
const problems = (html: string, letter = false) =>
  accessibilityProblems(html, { letter }).map((p) => p.problem)

/** Brand colours from plain to hard: the blocks keep every one readable. */
const palettes = [
  sampleBrand,
  {
    ...sampleBrand,
    accent: '#ffd400',
    dark: '#ffffff',
    background: '#000000',
    ink: '#ffffff'
  },
  {
    ...sampleBrand,
    accent: '#e8e8e8',
    dark: '#cccccc',
    background: '#ffffff',
    ink: '#999999'
  },
  {
    ...sampleBrand,
    accent: '#ff6699',
    dark: '#330011',
    background: '#ffe0ec',
    ink: '#330011'
  },
  // Middle colours, where neither near-black nor white reaches 4.5.
  { ...sampleBrand, accent: '#d64545', dark: '#d64545' },
  { ...sampleBrand, accent: '#e0218a', dark: '#7a7a7a' },
  { ...sampleBrand, accent: '#7a7a7a', dark: '#1976d2' }
]

describe('accessibility on every email (owner pick #96)', () => {
  it('passes an email with its language, title, headings, readable words and named links', () => {
    expect(problems(page(ok))).toEqual([])
  })

  it('passes every block the app draws, in any brand colours, and every text email', () => {
    for (const brand of palettes) {
      const html = renderEmail({
        blocks: Object.values(sampleBlocks),
        brand,
        subject: 'Meet the throw',
        preheader: 'Soft linen, made by hand.'
      })
      expect(problems(html), brand.accent).toEqual([])
      const { html: letter } = renderLetter(
        letterSchema.parse({
          subject: 'A note about the candle',
          preheader: 'Why we made it, and what it smells like at home.',
          greeting: 'Hi there,',
          body: [
            'We poured the first candle.',
            'The candle [is in the shop](1).'
          ],
          signoff: 'Warmly,',
          signature: 'Maya',
          links: [{ url: 'https://cedar-lane.example/p' }]
        }),
        { brand, mode: 'klaviyo' }
      )
      expect(problems(letter, true), brand.accent).toEqual([])
    }
  })

  it('passes every golden email the build makes', async () => {
    const taken: string[] = []
    for (const brief of goldenBriefs) {
      const run = await runGolden(brief, {
        agents: null,
        fallbacks: memoryFallbackLog(),
        taken: [...taken]
      })
      if (!run.result.ok) continue
      taken.push(run.result.email.subject)
      expect(problems(run.result.email.html), brief.id).toEqual([])
    }
  })

  it('asks for the language, the title and layout tables marked as layout', () => {
    expect(problems(page(ok).replace(' lang="en"', ''))).toEqual([
      'The email does not say its language, so a screen reader may read it in the wrong voice.'
    ])
    expect(problems(page(ok, '<title> </title>'))).toEqual([
      'The email has no title for a screen reader to name it by.'
    ])
    expect(
      problems(page(`${ok}<table><tr><td>x</td></tr></table><table></table>`))
    ).toEqual([
      '2 layout tables do not say they are layout, so a screen reader reads out their rows and columns.'
    ])
  })

  it('asks a designed email for real headings in order; a letter has none', () => {
    const none = page(
      '<p>Soft linen.</p><a href="https://shop.example">Shop</a>'
    )
    expect(problems(none)).toEqual([
      'The email has no real heading, so a screen reader cannot jump to its parts.'
    ])
    expect(problems(none, true)).toEqual([])
    expect(problems(page(`${ok}<h3>Details</h3>`))).toEqual([
      'The email’s headings skip a level, which confuses a screen reader.'
    ])
    expect(problems(page(`<h3>First</h3>${ok}`))).toEqual([
      'The email’s headings skip a level, which confuses a screen reader.'
    ])
    expect(problems(page(`<h2>A</h2>${ok}<h2>B</h2><h3>C</h3>`))).toEqual([])
  })

  it('measures every piece of text against the background it sits on, as drawn', () => {
    expect(faintText(page(ok))).toBeNull()
    // Pale grey on white, and on a set background through its parents.
    expect(
      faintText(page(`${ok}<p style="color:#bbbbbb">Small print</p>`))
    ).toEqual({ pieces: 1, worst: 1.9 })
    expect(
      faintText(
        page(
          `<div style="background:#2f4a3a"><table role="presentation"><tr><td bgcolor="#2f4a3a"><span style="color:#333333">Dark on dark</span></td></tr></table></div>`
        )
      )
    ).toMatchObject({ pieces: 1 })
    // Large text needs 3: pale enough for small text, fine at 28 px bold.
    const mid = 'color:#888888'
    expect(faintText(page(`<p style="${mid}">Small</p>`))).not.toBeNull()
    expect(
      faintText(page(`<p style="${mid};font-size:28px">Large</p>`))
    ).toBeNull()
    expect(
      faintText(page(`<h2 style="${mid};font-size:20px">Bold heading</h2>`))
    ).toBeNull()
    // Text on a picture or a gradient: unknown, never guessed.
    expect(
      faintText(
        page(
          `<td style="background:url(https://cdn.example/a.jpg);color:#ffffff">On a photo</td>`
        )
      )
    ).toBeNull()
    // Hidden text (the preview line) is not read; rgb() colours are.
    expect(
      faintText(
        page(
          `<div style="display:none;color:#ffffff">Preview</div><p style="color:rgb(250, 250, 250)">Faint</p>`
        )
      )
    ).toEqual({ pieces: 1, worst: 1 })
    expect(problems(page(`${ok}<p style="color:#eeeeee">x</p>`))).toEqual([
      'A piece of text is hard to read on its background (contrast 1.1; 4.5 needed, 3 for large text).'
    ])
  })

  it('asks for links a screen reader can name, never only "click here"', () => {
    expect(
      problems(
        page(
          `${ok}<a href="https://shop.example"><img src="https://cdn.example/a.jpg" alt="The throw"></a>`
        )
      )
    ).toEqual([])
    expect(
      problems(
        page(
          `${ok}<a href="https://shop.example"><img src="https://cdn.example/a.jpg" alt=""></a>`
        )
      )
    ).toEqual(['A link has no words a screen reader can say.'])
    expect(
      problems(
        page(
          `${ok}<a href="https://shop.example">Click here</a> <a href="https://shop.example/x">Read more →</a>`
        )
      )
    ).toEqual(['2 links say only "click here" or the like: say where they go.'])
  })

  it('never counts the store’s own names: a brand called "Here" or "Icon"', () => {
    for (const name of ['Here', 'More', 'Icon', 'Banner']) {
      const brand = { ...sampleBrand, name, logo: 'https://cdn.example/l.png' }
      const html = renderEmail({
        blocks: Object.values(sampleBlocks),
        brand,
        subject: 'Meet the throw',
        preheader: 'Soft linen, made by hand.'
      })
      expect(
        accessibilityProblems(html, { own: [name] }).map((p) => p.problem),
        name
      ).toEqual([])
      // Without its name given, the same words are vague.
      expect(problems(html).length, name).toBeGreaterThan(0)
    }
  })

  it('reads a link’s aria-label and attributes in single quotes', () => {
    expect(
      problems(
        page(
          `${ok}<a href="https://shop.example" aria-label="Our Instagram"><img src="https://cdn.example/i.png" alt=""></a><table role='presentation'></table>`
        )
      )
    ).toEqual([])
  })

  it('asks pictures for words that describe them, never a file name or "image"', () => {
    for (const alt of ['image', 'IMG_2041.jpg', 'photo 3', 'banner'])
      expect(
        problems(
          page(`${ok}<img src="https://cdn.example/a.jpg" alt="${alt}">`)
        ),
        alt
      ).toEqual([
        'A picture’s words are a file name or "image": say what it shows.'
      ])
    expect(
      problems(
        page(`${ok}<img src="https://cdn.example/a.jpg" alt="A linen throw">`)
      )
    ).toEqual([])
  })

  it('is a hard check of the drawn email, each problem in fixed words', () => {
    const html = page(`${ok}<p style="color:#eeeeee">Secret code SAVE10</p>`)
    const found = hardProblems(html, { maxDiscountPercent: 20 }).filter(
      (p) => p.check === 'access'
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.problem).not.toContain('SAVE10')
    // A letter is never asked for headings.
    const letter = page(
      '<p>Hi there.</p><a href="https://shop.example">Shop</a>'
    )
    expect(
      hardProblems(letter, { maxDiscountPercent: 20, letter: true }).map(
        (p) => p.check
      )
    ).not.toContain('access')
  })
})
