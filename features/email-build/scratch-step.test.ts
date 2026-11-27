// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BuiltEmail } from './build'
import {
  copiedLines,
  scratchWords,
  type CopyInput,
  type CopyRecord,
  type CopyState,
  type LibraryCopyPort
} from './library-copy'
import { libraryWaits, libraryWaitSeconds } from './library-step'
import { sampleStoreFrom } from './ports'
import type { LibraryBlock } from './scratch'
import { savedPick, scratchStep } from './scratch-step'

/**
 * DES-ENGINE-004b: the design step of a Scratch email with the library on:
 * the plan from the library port (faked here), the saved pick, the waits,
 * and every way back to coded blocks with its plain reason.
 */
const tenantId = '00000000-0000-4000-8000-000000000101'
const store = () => sampleStoreFrom('2026-03-02').read(tenantId)
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const facts = (over: Partial<LibraryBlock['facts']> = {}) => ({
  width: 600,
  height: 300,
  columns: 1,
  photos: [],
  products: 0,
  texts: 1,
  buttons: 0,
  headline: false,
  logo: false,
  icons: 0,
  prices: false,
  oldPrice: false,
  code: false,
  footer: false,
  band: false,
  ...over
})
const lib: LibraryBlock[] = [
  {
    id: id(1),
    kind: 'hero',
    facts: facts({ headline: true }),
    width: 600,
    uses: 5,
    brands: 2,
    emailTypes: [],
    yours: false
  },
  {
    id: id(2),
    kind: 'text',
    facts: facts(),
    width: 600,
    uses: 3,
    brands: 1,
    emailTypes: [],
    yours: false
  },
  {
    id: id(3),
    kind: 'button',
    facts: facts({ buttons: 1 }),
    width: 600,
    uses: 4,
    brands: 1,
    emailTypes: [],
    yours: true
  },
  {
    id: id(4),
    kind: 'footer',
    facts: facts({ footer: true }),
    width: 600,
    uses: 9,
    brands: 3,
    emailTypes: [],
    yours: false
  }
]
const record = (over: Partial<CopyRecord> = {}): CopyRecord => ({
  html: '<html lang="en"><body>scratch</body></html>',
  sections: [
    { ordinal: 1, kind: 'hero', result: 'copied', reason: null },
    { ordinal: 2, kind: 'text', result: 'copied', reason: null }
  ],
  pass: true,
  leaks: [],
  footerAdded: false,
  photos: [],
  ...over
})

function fakePort(
  copy: CopyState = { state: 'queued' },
  blocks = lib,
  stored: string[] | null = null
) {
  const asked: { blocks: readonly string[]; input: CopyInput }[] = []
  let reads = 0
  const port: NonNullable<LibraryCopyPort['scratch']> = {
    library: async () => {
      reads++
      return { blocks, recent: [] }
    },
    stored: async () => stored,
    copy: async (b, input) => {
      asked.push({ blocks: b, input })
      return copy
    }
  }
  return { port, asked, reads: () => reads }
}

async function step(
  port: NonNullable<LibraryCopyPort['scratch']>,
  saved: unknown = undefined,
  checks: (html: string) => { check: string; problem: string }[] = () => []
) {
  return scratchStep({
    port,
    buildId: 'email-build:b1',
    emailType: 'story',
    store: await store(),
    draft: {
      subject: 'S',
      preheader: 'P',
      blocks: [{ type: 'text', content: { headline: 'Our story' } }],
      productIds: [],
      code: null
    } as never,
    rules: { maxDiscountPercent: 20, codes: [] },
    coded: { subject: 'Coded', html: '<p>coded</p>' } as BuiltEmail,
    saved,
    checks
  })
}

describe('the Scratch step (DES-ENGINE-004b)', () => {
  it('plans from the library, keeps the pick and waits for the copy, 3 times, then coded blocks', async () => {
    const { port, asked, reads } = fakePort()
    const first = await step(port)
    expect(first).toEqual({
      kind: 'waiting',
      work: { library: { waits: 1, blocks: [id(1), id(2), id(3), id(4)] } },
      seconds: libraryWaitSeconds
    })
    expect(asked[0]!.input.mode).toBe('klaviyo')
    // No other brand's names in the input: the job reads each source's.
    expect(asked[0]!.input.sourceNames).toEqual([])
    // A later claim asks for the same pick, without reading the library.
    const saved = (first as { work: unknown }).work
    await step(port, saved)
    expect(reads()).toBe(1)
    expect(asked[1]!.blocks).toEqual(asked[0]!.blocks)
    expect(
      await step(port, {
        library: { waits: libraryWaits, blocks: [id(1), id(4), id(2)] }
      })
    ).toEqual({
      kind: 'coded',
      reasonCode: 'scratch_copying',
      reason: scratchWords.copying
    })
  })

  it('says why when the library cannot build the email', async () => {
    const { port, asked } = fakePort({ state: 'queued' }, [])
    const got = await step(port)
    expect(got).toMatchObject({ kind: 'coded', reasonCode: 'scratch_no_plan' })
    expect((got as { reason: string }).reason).toMatch(
      /^GROS could not build this email from the block library \(the library has no hero or image layout/
    )
    expect(asked).toEqual([])
  })

  it('draws coded blocks when the copy failed, leaked or failed a hard check', async () => {
    expect(
      await step(
        fakePort({ state: 'failed', reason: 'the copy could not be drawn' })
          .port
      )
    ).toEqual({
      kind: 'coded',
      reasonCode: 'scratch_failed',
      reason: scratchWords.failed('the copy could not be drawn')
    })
    expect(
      await step(
        fakePort({
          state: 'done',
          record: record({ leaks: [{ kind: 'word', value: 'rival' }] })
        }).port
      )
    ).toEqual({
      kind: 'coded',
      reasonCode: 'scratch_leaks',
      reason: scratchWords.leaks
    })
    expect(
      await step(
        fakePort({ state: 'done', record: record() }).port,
        undefined,
        () => [{ check: 'access', problem: 'No heading.' }]
      )
    ).toEqual({
      kind: 'coded',
      reasonCode: 'scratch_check_access',
      reason: `${scratchWords.checks} No heading.`
    })
  })

  it('a done copy that passes is the email, and its page says it came from the library', async () => {
    const got = await step(fakePort({ state: 'done', record: record() }).port)
    expect(got.kind).toBe('email')
    const email = (got as { email: BuiltEmail }).email
    expect(email.html).toContain('scratch')
    expect(email.library).toMatchObject({ emailId: 'scratch', scratch: 4 })
    expect(copiedLines(email.library!)[0]).toMatch(
      /^Built from 4 layouts in the GROS block library/
    )
  })

  it('reads only a well-formed saved pick', () => {
    expect(savedPick({ library: { blocks: [id(1)] } })).toEqual([id(1)])
    expect(savedPick({ library: { blocks: ['x'] } })).toBeNull()
    expect(savedPick({ library: { blocks: [] } })).toBeNull()
    expect(savedPick(undefined)).toBeNull()
  })

  it('a lost saved pick takes the one this build’s copy already asked for, never a new one', async () => {
    const { port, asked, reads } = fakePort({ state: 'queued' }, lib, [
      id(4),
      id(1)
    ])
    expect(await step(port)).toMatchObject({
      kind: 'waiting',
      work: { library: { blocks: [id(4), id(1)] } }
    })
    expect(asked[0]!.blocks).toEqual([id(4), id(1)])
    expect(reads()).toBe(0)
  })
})
