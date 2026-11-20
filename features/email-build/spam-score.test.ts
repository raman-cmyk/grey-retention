// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { memoryFallbackLog } from '@/features/fallback/log'
import { goldenBriefs } from './golden/briefs'
import { runGolden } from './golden/run'
import { hardProblems } from './hard-checks'
import {
  spamLimit,
  spamProblem,
  spamScore,
  subjectBPasses,
  type SpamStore
} from './spam-score'

/** Owner pick #93: the spam check before the push. */
const preheader = 'Woven in Portugal, softer every wash'
const page = (body: string, preview = preheader) =>
  `<!doctype html><html><head><title>Hello</title><style>.x{display:none}</style></head><body><div style="display:none;max-height:0;overflow:hidden">${preview}&#847;&zwnj;</div>${body}</body></html>`
const words =
  '<p>Our linen throw is woven in Portugal from flax grown nearby. It softens with every wash and keeps you warm on cool evenings without the weight of wool. Each one is finished by hand, so the edges stay neat for years.</p>'
const link = (href: string, text = 'Shop the throw') =>
  `<a href="${href}">${text}</a>`
const score = (
  html: string,
  subject = 'Meet the linen throw',
  store: SpamStore = {}
) => spamScore({ subject, preheader, html }, store)
const rules = (html: string, subject?: string, store?: SpamStore) =>
  score(html, subject, store).hits.map((h) => h.rule)
const picture = (alt = 'The throw') =>
  `<img src="https://cdn.example/${alt.length}.jpg" alt="${alt}">`

describe('the spam check (owner pick #93)', () => {
  it('gives a plain store email no points', () => {
    expect(score(page(words + link('https://shop.example/throw')))).toEqual({
      score: 0,
      hits: []
    })
  })

  it('scores every golden email the build makes with no points at all', async () => {
    const taken: string[] = []
    for (const brief of goldenBriefs) {
      const run = await runGolden(brief, {
        agents: null,
        fallbacks: memoryFallbackLog(),
        taken: [...taken]
      })
      if (!run.result.ok) continue
      taken.push(run.result.email.subject)
      const { store } = run
      expect(
        spamScore(run.result.email, {
          text: [store.brand.name, ...store.products.map((p) => p.title)],
          name: store.brand.name
        }),
        brief.id
      ).toEqual({ score: 0, hits: [] })
    }
  })

  it('reads the subject: capitals, exclamations, a fake reply, spam words, money', () => {
    const html = page(words + link('https://shop.example/throw'))
    expect(rules(html, 'MEET THE LINEN THROW')).toEqual(['subject_capitals'])
    expect(rules(html, 'Meet the throw!!')).toEqual(['subject_exclaims'])
    expect(rules(html, 'Meet the throw?!')).toEqual(['subject_exclaims'])
    expect(rules(html, 'RE: your linen throw')).toEqual(['subject_fake_reply'])
    expect(rules(html, 'Fwd: the throw')).toEqual(['subject_fake_reply'])
    expect(rules(html, 'Act now, winner')).toEqual(['subject_spam_words'])
    expect(rules(html, 'Free throw worth $90')).toEqual(['subject_money'])
    // One capital word ("NEW") is not shouting; the copy checks catch it.
    expect(rules(html, 'The NEW linen throw')).toEqual([])
  })

  it('never counts the store’s own words: its name, products and reviews in capitals or spam words', () => {
    const store: SpamStore = {
      text: ['CEDAR LANE', 'OAK TRAY', 'LINEN THROW', 'A real winner, no risk'],
      name: 'CEDAR LANE'
    }
    const loud = page(
      `${picture('CEDAR LANE')}<h1>OAK TRAY</h1><p>LINEN THROW</p>${words}<p>“A real winner, no risk”</p>${link('https://shop.example')}`
    )
    expect(score(loud, 'News from CEDAR LANE', store)).toEqual({
      score: 0,
      hits: []
    })
    // The same words the writer wrote do count.
    expect(rules(loud, 'News from CEDAR LANE')).toEqual([
      'subject_capitals',
      'body_spam_words'
    ])
  })

  it('reads the body as a reader sees it, and only the preview line’s hidden block is let off', () => {
    const shout = `<p>${'BIG SALE TODAY ONLY '.repeat(10)}</p>`
    expect(rules(page(words + shout + link('https://shop.example')))).toContain(
      'body_capitals'
    )
    expect(rules(page(`${words}<p>Wow! Yes! Now! Go!</p>`))).toContain(
      'body_exclaims'
    )
    expect(
      score(page(`${words}<p>${'Yes! '.repeat(9)}</p>`)).hits.find(
        (h) => h.rule === 'body_exclaims'
      )?.points
    ).toBe(2)
    expect(rules(page(`${words}<p>Click here and act now.</p>`))).toEqual([
      'body_spam_words'
    ])
    // Another hidden block, before the preview line's, is hidden words.
    const twice = page(words).replace(
      '<body>',
      '<body><div style="display:none">secret words</div>'
    )
    expect(rules(twice)).toEqual(['hidden_words'])
    // With no preview line, no hidden block is let off.
    expect(
      spamScore({ subject: 'Hi', preheader: '', html: page(words) }).hits.map(
        (h) => h.rule
      )
    ).toEqual(['hidden_words'])
  })

  it('finds an email that is nearly all pictures, never counting its logo', () => {
    const store: SpamStore = { name: 'Cedar Lane' }
    expect(score(page(picture() + link('https://shop.example'))).hits).toEqual([
      expect.objectContaining({ rule: 'mostly_pictures', points: 2.5 })
    ])
    expect(
      score(
        page(
          picture() +
            picture('Two throws') +
            picture('Three') +
            '<p>Soft linen, made by hand in Portugal from flax grown nearby, for cool evenings at home.</p>'
        )
      ).hits
    ).toEqual([
      expect.objectContaining({ rule: 'mostly_pictures', points: 1.5 })
    ])
    expect(score(page(picture() + words)).hits).toEqual([])
    // A logo and a few words: no picture against them.
    expect(
      rules(
        page(picture('Cedar Lane') + '<p>See you soon.</p>'),
        undefined,
        store
      )
    ).toEqual([])
    // Klaviyo's footer tags are not words.
    expect(
      rules(
        page(
          `${picture()}<p>{{ organization.name }} {{ organization.full_address }} {% unsubscribe %}</p>`
        )
      )
    ).toEqual(['mostly_pictures'])
  })

  it('finds short links, bare address links and link words naming another site', () => {
    expect(rules(page(words + link('https://bit.ly/x1')))).toEqual([
      'short_link'
    ])
    expect(rules(page(words + link('https://203.0.113.9/x')))).toEqual([
      'address_link'
    ])
    expect(
      rules(page(words + link('https://other.example/x', 'www.shop.example')))
    ).toEqual(['link_words_elsewhere'])
    // Its own site, with or without www, is fine.
    expect(
      rules(page(words + link('https://www.shop.example/x', 'shop.example')))
    ).toEqual([])
    // The store's header: its name on a link to one of its own hosts.
    const header = link('https://cedar.myshopify.example/', 'Cedarlane.co')
    expect(
      rules(page(words + header), undefined, {
        hosts: ['cedar.myshopify.example']
      })
    ).toEqual([])
    expect(
      rules(page(words + header), undefined, { name: 'Cedarlane.co' })
    ).toEqual([])
    // The href is read, never a data-href before it.
    expect(
      rules(
        page(
          `${words}<a data-href="https://bit.ly/x" href="https://shop.example">Shop</a>`
        )
      )
    ).toEqual([])
  })

  it('finds words hidden or too small to read, inside other tags too', () => {
    expect(
      rules(page(`${words}<span style="font-size:0px">cheap pills</span>`))
    ).toEqual(['hidden_words'])
    expect(
      rules(
        page(`${words}<div style="display: none"><span>secret</span></div>`)
      )
    ).toEqual(['hidden_words'])
    expect(
      rules(page(`${words}<p style="opacity:0">secret words</p>`))
    ).toEqual(['hidden_words'])
    // A wrapper at font-size 0 around columns with their own size: fine.
    expect(
      rules(
        page(
          `<td style="font-size:0"><div style="display:inline-block;font-size:16px">${words}</div></td>`
        )
      )
    ).toEqual([])
    // A store word never hides a spam word it is only part of.
    expect(rules(page(words), 'Our winner is back', { text: ['Win'] })).toEqual(
      ['subject_spam_words']
    )
    // MJML-style empty columns at font-size 0 hold no words of their own.
    expect(rules(page(`<div style="font-size:0"></div>${words}`))).toEqual([])
  })

  it('finds very many links or sites', () => {
    const many = Array.from({ length: 41 }, (_, i) =>
      link(`https://shop.example/p${i}`)
    ).join(' ')
    expect(rules(page(words + many))).toEqual(['many_links'])
    const sites = Array.from({ length: 7 }, (_, i) =>
      link(`https://site${i}.example/`)
    ).join(' ')
    expect(rules(page(words + sites))).toEqual(['many_sites'])
  })

  it('fails at the limit, saying the score and what cost most in fixed words', () => {
    const bad = page(picture('x') + link('https://bit.ly/x'))
    const result = score(bad, 'RE: you have been selected')
    expect(result.score).toBeGreaterThanOrEqual(spamLimit)
    const problem = spamProblem(result)!
    expect(problem).toMatch(
      /^The email scores [\d.]+ on the spam check \(5 fails\): /
    )
    expect(problem).toContain('nearly all pictures')
    expect(problem).not.toMatch(/selected|bit\.ly/)
    expect(spamProblem(score(page(words)))).toBeNull()
  })

  it('weighs a second subject (the lab’s B) with the email’s body', () => {
    const near = score(page(picture() + link('https://shop.example')))
    expect(near.score).toBe(2.5)
    expect(subjectBPasses(near, 'Quiet evenings, picked for you')).toBe(true)
    expect(subjectBPasses(near, 'RE: quiet evenings')).toBe(false)
    // B's own words from the store do not count.
    expect(subjectBPasses(near, 'RE: OAK TRAY', ['OAK TRAY'])).toBe(false)
    expect(subjectBPasses(near, 'OAK TRAY, back', ['OAK TRAY'])).toBe(true)
  })

  it('is a hard check of the drawn email, with its subject, preview line and store', () => {
    const bad = page(picture('x') + link('https://shop.example/x'))
    const checks = (subject: string, storeText: string[] = []) =>
      hardProblems(bad, {
        maxDiscountPercent: 20,
        subject,
        preheader,
        storeText
      }).map((p) => p.check)
    expect(checks('RE: you have been selected')).toContain('spam')
    expect(checks('Meet the throw')).not.toContain('spam')
    // Known words (product names) are the store's own too.
    expect(
      hardProblems(bad, {
        maxDiscountPercent: 20,
        subject: 'WINNER OAK TRAY',
        preheader,
        known: ['WINNER OAK TRAY']
      }).map((p) => p.check)
    ).not.toContain('spam')
  })
})
