// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import {
  madeVariantSchema,
  makeVariant,
  variantMaker,
  type VariantInput
} from './maker'
import { agentAsk, TagError, type AiRun, type Ask } from './passes'
import { fingerprintOf, seedSpecs, type VariantSpec } from './variants'

const skeleton: VariantSpec = {
  rows: [
    {
      columns: [
        {
          width: 0.5,
          slots: [
            { kind: 'image', role: 'product', aspect: '1:1', bleed: false }
          ]
        },
        {
          width: 0.5,
          slots: [
            { kind: 'heading', size: 's' },
            { kind: 'price' },
            { kind: 'button', style: 'solid' }
          ]
        }
      ]
    }
  ],
  align: 'left',
  background: 'none',
  padding: 'm'
}
const image = { mediaType: 'image/jpeg' as const, base64: 'AAAA' }
const input: VariantInput = {
  sectionId: 's1',
  family: 'product_feature',
  layout: 'image_left',
  purpose: 'product_showcase',
  styles: ['photo_led'],
  skeleton,
  image
}
/** The agent's better reading: the text sits under the picture. */
const answer: VariantSpec = {
  ...skeleton,
  rows: [
    {
      columns: [
        {
          width: 0.6,
          slots: [
            { kind: 'image', role: 'product', aspect: '4:5', bleed: false }
          ]
        },
        {
          width: 0.4,
          slots: [
            { kind: 'eyebrow' },
            { kind: 'heading', size: 'm' },
            { kind: 'price' },
            { kind: 'button', style: 'outline' }
          ]
        }
      ]
    }
  ]
}
const gemini = (content: unknown, model = 'gemini-2.5-flash'): AiRun => ({
  ok: true,
  content,
  provider: 'gemini',
  model
})
const askWith = (run: AiRun) => {
  const mock = vi.fn(async () => run)
  return mock as unknown as Ask & typeof mock
}

describe('the Variant maker', () => {
  it('keeps a sure, drawable answer, made on the review tier with the crop', async () => {
    const ask = askWith(gemini({ spec: answer, confidence: 0.8 }))
    expect(await makeVariant(input, ask, 'apparel')).toEqual({
      state: 'made',
      spec: answer,
      fingerprint: fingerprintOf('product_feature', answer),
      pass: 'maker',
      model: 'gemini-2.5-flash'
    })
    expect(ask.mock.calls[0]).toEqual([
      variantMaker,
      input,
      { callerKey: 'variant:s1', tier: 'review', industry: 'apparel' }
    ])
    expect(variantMaker.images!(input)).toEqual([image])
  })

  it('keeps the structure read from the HTML when the AI is the fake, unsure, unreadable or refuses', async () => {
    const skeletonMade = {
      state: 'made',
      spec: skeleton,
      fingerprint: fingerprintOf('product_feature', skeleton),
      pass: 'skeleton'
    }
    const fake = askWith({
      ok: true,
      content: null,
      provider: 'fake',
      model: 'fake'
    })
    expect(await makeVariant(input, fake)).toEqual({
      ...skeletonMade,
      model: null
    })
    for (const run of [
      gemini({ spec: answer, confidence: 0.4 }),
      gemini({ spec: { rows: [] }, confidence: 0.9 })
    ])
      expect(await makeVariant(input, askWith(run))).toEqual({
        ...skeletonMade,
        model: 'gemini-2.5-flash'
      })
    for (const code of ['invalid_output', 'refused', 'incomplete'])
      expect(await makeVariant(input, askWith({ ok: false, code }))).toEqual({
        ...skeletonMade,
        model: null
      })
  })

  it('refuses an answer that cannot be drawn: columns not filling the row, or a product block without its price', async () => {
    const short = {
      ...answer,
      rows: [{ columns: [{ ...answer.rows[0]!.columns[0]!, width: 0.6 }] }]
    }
    const noPrice = {
      ...answer,
      rows: [
        {
          columns: [
            answer.rows[0]!.columns[0]!,
            {
              width: 0.4,
              slots: [{ kind: 'heading' as const, size: 'm' as const }]
            }
          ]
        }
      ]
    }
    for (const spec of [short, noPrice])
      expect(
        await makeVariant(input, askWith(gemini({ spec, confidence: 0.9 })))
      ).toMatchObject({ state: 'made', pass: 'skeleton' })
  })

  it('leaves a section out when neither the answer nor the HTML structure can be drawn', async () => {
    const noPrice: VariantSpec = {
      ...skeleton,
      rows: [{ columns: [{ width: 1, slots: [{ kind: 'text', lines: 2 }] }] }]
    }
    expect(
      await makeVariant(
        { ...input, skeleton: noPrice },
        askWith(gemini({ spec: noPrice, confidence: 0.9 }))
      )
    ).toEqual({
      state: 'dropped',
      reason: 'unusable',
      model: 'gemini-2.5-flash',
      remember: true
    })
    // Without a real answer it is tried again once a model is set up.
    for (const run of [
      { ok: true, content: null, provider: 'fake', model: 'fake' } as AiRun,
      { ok: false, code: 'incomplete' } as AiRun
    ])
      expect(
        await makeVariant({ ...input, skeleton: noPrice }, askWith(run))
      ).toEqual({
        state: 'dropped',
        reason: 'unusable',
        model: null,
        remember: false
      })
  })

  it('leaves a structure far too large out without a call', async () => {
    const huge: VariantSpec = {
      ...skeleton,
      rows: Array.from({ length: 6 }, () => ({
        columns: Array.from({ length: 4 }, () => ({
          width: 0.25,
          slots: Array.from({ length: 3 }, () => ({
            kind: 'text' as const,
            lines: 1
          }))
        }))
      }))
    }
    const ask = askWith(gemini({ spec: answer, confidence: 0.9 }))
    expect(await makeVariant({ ...input, skeleton: huge }, ask)).toEqual({
      state: 'dropped',
      reason: 'unusable',
      model: null,
      remember: true
    })
    expect(ask).not.toHaveBeenCalled()
  })

  it('throws a failure worth another try, so the job is tried again or put back', async () => {
    await expect(
      makeVariant(
        input,
        askWith({ ok: false, code: 'rate_limited', retryAfterSeconds: 30 })
      )
    ).rejects.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      retryAfterSeconds: 30
    })
    await expect(
      makeVariant(input, askWith({ ok: false, code: 'cap_reached' }))
    ).rejects.toBeInstanceOf(TagError)
  })

  it('reads a flat answer per slot kind, dropping settings a kind does not take', () => {
    const parsed = madeVariantSchema.parse({
      spec: {
        ...skeleton,
        rows: [
          {
            columns: [
              {
                width: 1,
                slots: [
                  { kind: 'eyebrow', size: 'xl', lines: 3 },
                  { kind: 'image', role: 'logo', aspect: 'free' }
                ]
              }
            ]
          }
        ]
      },
      confidence: 0.7
    })
    expect(parsed.spec.rows[0]!.columns[0]!.slots).toEqual([
      { kind: 'eyebrow' },
      { kind: 'image', role: 'logo', aspect: 'free', bleed: false }
    ])
  })

  it('sends only the structure and the tags: never words, links or colours', () => {
    const task = JSON.parse(variantMaker.task(input)) as Record<string, unknown>
    expect(Object.keys(task).sort()).toEqual([
      'family',
      'layout',
      'purpose',
      'structure',
      'styles'
    ])
    expect(variantMaker).toMatchObject({
      purpose: 'review',
      temperature: 0,
      reasoningEffort: 'none'
    })
    // Every seed fits the answer shape the model is given.
    const shape = JSON.stringify(variantMaker.schema.definition)
    for (const seed of Object.values(seedSpecs))
      for (const slot of seed.spec.rows.flatMap((r) =>
        r.columns.flatMap((c) => c.slots)
      ))
        expect(shape).toContain(`"${slot.kind}"`)
  })

  it('runs through MEM-001 runAgent as platform work on the review purpose', async () => {
    const ai = vi.fn<AiCall>(async () => ({
      ok: true,
      content: { spec: answer, confidence: 0.9 },
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      costMicro: 10,
      inputTokens: 100,
      outputTokens: 20,
      settled: true
    }))
    const log = new InMemoryRunLog()
    const ask = agentAsk({ ai, memory: new InMemoryMemoryStore(), log })
    expect(await makeVariant(input, ask)).toMatchObject({
      state: 'made',
      pass: 'maker'
    })
    expect(
      ai.mock.calls.map(([c]) => [c.tenantId, c.purpose, c.callerKey])
    ).toEqual([[null, 'review', 'variant-maker:variant:s1']])
    expect(ai.mock.calls[0]![0].request.images).toEqual([image])
    expect(log.entries.map((e) => [e.agent, e.verdict])).toEqual([
      ['variant-maker', 'ok']
    ])
  })
})
