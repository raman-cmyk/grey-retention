// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BuiltEmail } from './build'
import {
  copiedLines,
  copyWords,
  uploadWords,
  type CopyInput,
  type CopyRecord,
  type CopyState,
  type LibraryCopyPort,
  type UploadBlueprintState
} from './library-copy'
import { libraryStep } from './library-step'
import { sampleStoreFrom } from './ports'

/**
 * DES-ENGINE-003b: the design step of an email copied from one of the
 * workspace's own uploads: its state, its copy (the brand's own design
 * keeps its look, no leak check against itself), and every way back to
 * coded blocks with its plain reason.
 */
const tenantId = '00000000-0000-4000-8000-000000000101'
const upload = '00000000-0000-4000-8000-0000000000c1'

const record = (over: Partial<CopyRecord> = {}): CopyRecord => ({
  html: '<html lang="en"><body>copy</body></html>',
  sections: [
    { ordinal: 1, kind: 'header', result: 'copied', reason: null },
    {
      ordinal: 2,
      kind: 'image',
      result: 'library',
      reason:
        'Section 2 (picture) has a picture on mailer.example, a site GROS doesn’t load pictures from, so it was built from the library’s Image block.'
    }
  ],
  pass: false,
  leaks: [],
  footerAdded: false,
  photos: [],
  ...over
})

function port(
  state: UploadBlueprintState,
  copy: CopyState = { state: 'queued' }
) {
  const asked: { uploadId: string; input: CopyInput; photos: number }[] = []
  const p: LibraryCopyPort = {
    blueprint: async () => {
      throw new Error('never an inspiration email')
    },
    copy: async () => {
      throw new Error('never an inspiration email')
    },
    upload,
    uploadBlueprint: async () => state,
    copyUpload: async (uploadId, input, photos) => {
      asked.push({ uploadId, input, photos })
      return copy
    }
  }
  return { port: p, asked }
}

async function step(
  p: LibraryCopyPort,
  saved: unknown = undefined,
  checks = () => [] as { check: string; problem: string }[]
) {
  const s = await sampleStoreFrom('2026-03-02').read(tenantId)
  return libraryStep({
    port: p,
    emailId: upload,
    uploadId: upload,
    store: s,
    draft: {
      subject: 'S',
      preheader: 'P',
      blocks: [
        { type: 'hero_product', content: { headline: 'Our cedar candle' } }
      ],
      productIds: ['p-cedar-candle'],
      code: null
    } as never,
    rules: { maxDiscountPercent: 20, codes: [] },
    coded: { subject: 'Coded', html: '<p>coded</p>' } as BuiltEmail,
    saved,
    checks
  })
}

describe('the design step of an email copied from an upload (DES-ENGINE-003b)', () => {
  it('asks for the copy of the upload, its look kept when it is the brand’s own', async () => {
    const own = port({ state: 'ready', design: 'own' })
    expect((await step(own.port)).kind).toBe('waiting')
    expect(own.asked[0]!.uploadId).toBe(upload)
    expect(own.asked[0]!.input.keepLook).toBe(true)
    expect(own.asked[0]!.input.sourceNames).toEqual([])
    const other = port({ state: 'ready', design: 'other' })
    await step(other.port)
    expect(other.asked[0]!.input.keepLook).toBeUndefined()
  })

  it('makes the email from a done copy, saying it was the owner’s own design', async () => {
    const own = port(
      { state: 'ready', design: 'own' },
      { state: 'done', record: record() }
    )
    const got = await step(own.port)
    expect(got.kind).toBe('email')
    if (got.kind !== 'email') return
    expect(got.email.library).toEqual({
      emailId: upload,
      upload: 'own',
      sections: record().sections,
      footerAdded: false
    })
    expect(copiedLines(got.email.library!)[0]).toMatch(
      /^Your own design was kept/
    )
    expect(copiedLines(got.email.library!)[1]).toMatch(/^Section 2 \(picture\)/)
  })

  it('draws coded blocks, with the reason, for an upload not ready, gone or not kept', async () => {
    expect(
      await step(port({ state: 'waiting' }).port, { library: { waits: 3 } })
    ).toEqual({
      kind: 'coded',
      reasonCode: 'library_waiting',
      reason: copyWords.uploadWaiting
    })
    expect(
      await step(port({ state: 'unusable', reason: uploadWords.gone }).port)
    ).toEqual({
      kind: 'coded',
      reasonCode: 'library_unusable',
      reason: copyWords.uploadFailed(uploadWords.gone)
    })
    expect(
      await step(
        port(
          { state: 'ready', design: 'own' },
          {
            state: 'done',
            record: record({
              look: ['Section 1 (header) has another logo than the original.']
            })
          }
        ).port
      )
    ).toEqual({
      kind: 'coded',
      reasonCode: 'library_look',
      reason: copyWords.uploadLook
    })
    expect(
      await step(
        port(
          { state: 'ready', design: 'other' },
          {
            state: 'done',
            record: record({ leaks: [{ kind: 'name', value: 'Rival' }] })
          }
        ).port
      )
    ).toMatchObject({ kind: 'coded', reasonCode: 'library_leaks' })
    expect(
      await step(
        port(
          { state: 'ready', design: 'own' },
          { state: 'failed', reason: uploadWords.pictures }
        ).port
      )
    ).toEqual({
      kind: 'coded',
      reasonCode: 'library_failed',
      reason: copyWords.uploadFailed(uploadWords.pictures)
    })
  })

  it('says how another brand’s uploaded email was copied', () => {
    expect(copiedLines({ sections: [], upload: 'other' })).toEqual([
      'Every section was copied from the email you added, with your brand’s colours, fonts, logo, words and photos.'
    ])
  })
})
