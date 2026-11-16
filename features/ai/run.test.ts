// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { runAi } from './run'
import {
  aiAvailability,
  aiSetup,
  aiTakesPictures,
  cappedAiEnv,
  openAiBaseUrl
} from './setup'
import { estimateMicro } from '@/lib/providers/openai-pricing'
import { InMemoryBudgetLedger, SupabaseBudgetLedger } from './budget-ledger'
import { geminiEstimateMicro } from '@/lib/providers/gemini-pricing'

const tenantId = '00000000-0000-4000-8000-000000000101'
const env = (values: Record<string, string>) =>
  values as unknown as NodeJS.ProcessEnv
const live = env({ GEMINI_API_KEY: 'test-key' })
const request = {
  system: 'Label the section.',
  user: '<table>hero</table>',
  maxOutputTokens: 256,
  temperature: 0,
  responseKind: 'json' as const,
  schema: { name: 'section_label', definition: { type: 'object' } }
}
const geminiOk = () =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: '{"block":"hero_product"}' }] },
          finishReason: 'STOP'
        }
      ],
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 20 }
    }),
    { status: 200 }
  )

describe('aiSetup', () => {
  it('uses the fake when forced, or when no key is set', () => {
    expect(
      aiSetup(
        'label',
        env({ AI_DEFAULT_PROVIDER: 'fake', GEMINI_API_KEY: 'k' })
      )
    ).toMatchObject({ provider: 'fake', reason: 'fake_selected' })
    expect(aiSetup('label', env({}))).toMatchObject({
      provider: 'fake',
      reason: 'missing_key'
    })
  })

  it('picks Flash-Lite for labels and Flash for copy (D5)', () => {
    expect(aiSetup('label', live)).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite'
    })
    expect(aiSetup('copy', live)).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.5-flash'
    })
  })

  it('uses Gemini 2.5 Pro for planning agents unless configured', () => {
    expect(aiSetup('plan', live)).toMatchObject({ model: 'gemini-2.5-pro' })
    expect(
      aiSetup(
        'plan',
        env({ GEMINI_API_KEY: 'k', GEMINI_PLAN_MODEL: 'gemini-2.5-flash' })
      )
    ).toMatchObject({ model: 'gemini-2.5-flash' })
  })

  it('takes model names from configuration and fails closed on unknown ones', () => {
    expect(
      aiSetup(
        'copy',
        env({
          GEMINI_API_KEY: 'test-key',
          GEMINI_COPY_MODEL: 'gemini-3-flash-preview'
        })
      )
    ).toMatchObject({ model: 'gemini-3-flash-preview' })
    expect(
      aiSetup(
        'label',
        env({
          GEMINI_API_KEY: 'test-key',
          GEMINI_LABEL_MODEL: 'gemini-unpriced'
        })
      )
    ).toEqual({ ready: false, provider: 'gemini', reason: 'unsupported_model' })
  })

  it('ignores the older Google key name, so a leftover key never starts spending', () => {
    expect(
      aiSetup('label', env({ GOOGLE_GENERATIVE_AI_KEY: 'old-key' }))
    ).toMatchObject({ provider: 'fake', reason: 'missing_key' })
    expect(
      aiSetup(
        'label',
        env({ AI_DEFAULT_PROVIDER: 'FAKE', GEMINI_API_KEY: 'k' })
      )
    ).toMatchObject({ provider: 'fake' })
  })

  it('never exposes the key in availability', () => {
    const shown = aiAvailability('label', live)
    expect(shown).toEqual({
      live: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      reason: null
    })
    expect(JSON.stringify(shown)).not.toContain('test-key')
    expect(aiAvailability('label', env({}))).toMatchObject({
      live: false,
      provider: 'fake',
      reason: 'missing_key'
    })
  })
})

describe('runAi', () => {
  it('answers from the fake at no cost and reserves nothing', async () => {
    const ledger = new InMemoryBudgetLedger(1)
    const result = await runAi(
      { tenantId, callerKey: 'label:1', purpose: 'label', request },
      { ledger, env: env({}) }
    )
    expect(result).toMatchObject({ ok: true, provider: 'fake', costMicro: 0 })
    expect(ledger.reservations.size).toBe(0)
  })

  it('sends a labelling call to Flash-Lite and records its real cost', async () => {
    const ledger = new InMemoryBudgetLedger(1_000_000)
    const fetch = vi.fn(async () => geminiOk())
    const result = await runAi(
      { tenantId, callerKey: 'label:2', purpose: 'label', request },
      { ledger, env: live, fetch }
    )
    expect(String((fetch.mock.calls as unknown[][])[0][0])).toContain(
      'gemini-2.5-flash-lite:generateContent'
    )
    // 500 input at $0.10/M + 20 output at $0.40/M = 50 + 8 micro-USD.
    expect(result).toMatchObject({
      ok: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      costMicro: 58,
      content: { block: 'hero_product' }
    })
    expect(ledger.spentMicro(tenantId)).toBe(58)
  })

  it('refuses over the cap without sending anything', async () => {
    const ledger = new InMemoryBudgetLedger(10)
    const fetch = vi.fn()
    const result = await runAi(
      { tenantId, callerKey: 'label:3', purpose: 'label', request },
      { ledger, env: live, fetch }
    )
    expect(result).toEqual({ ok: false, code: 'cap_reached' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps one client under the cap from spending another client’s allowance', async () => {
    const ledger = new InMemoryBudgetLedger(1_000)
    const other = '00000000-0000-4000-8000-000000000102'
    await ledger.reserve({
      tenantId: other,
      operationId: 'x',
      feature: 'copy',
      estimateMicro: 1_000
    })
    const result = await runAi(
      { tenantId, callerKey: 'label:4', purpose: 'label', request },
      { ledger, env: live, fetch: vi.fn(async () => geminiOk()) }
    )
    expect(result.ok).toBe(true)
  })

  it('settles zero for a provably unbilled failure, and the estimate when unknown', async () => {
    const ledger = new InMemoryBudgetLedger(1_000_000)
    const rateLimited = await runAi(
      { tenantId, callerKey: 'label:5', purpose: 'label', request },
      {
        ledger,
        env: live,
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }),
              { status: 429 }
            )
        )
      }
    )
    expect(rateLimited).toMatchObject({ ok: false, code: 'rate_limited' })
    expect(ledger.spentMicro(tenantId)).toBe(0)
    const down = await runAi(
      { tenantId, callerKey: 'label:6', purpose: 'label', request },
      {
        ledger,
        env: live,
        fetch: vi.fn(async () => new Response('{}', { status: 503 }))
      }
    )
    expect(down).toMatchObject({ ok: false, code: 'unavailable' })
    const reserved = [...ledger.reservations.values()].at(-1)!
    expect(reserved.actualMicro).toBe(reserved.estimateMicro)
  })

  it('meters every call separately, so a retry is never free', async () => {
    const ledger = new InMemoryBudgetLedger(1_000_000)
    const fetch = vi.fn(async () => geminiOk())
    const deps = { ledger, env: live, fetch }
    const input = {
      tenantId,
      callerKey: 'label:7',
      purpose: 'label' as const,
      request
    }
    await runAi(input, deps)
    await runAi(input, deps)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(ledger.reservations.size).toBe(2)
    expect(ledger.spentMicro(tenantId)).toBe(116)
    for (const r of ledger.reservations.values())
      expect(r.operationId).toMatch(/^ai:label:label:7:[0-9a-f-]{36}$/)
  })

  it('settles exactly once and reports a failed settle without retrying it', async () => {
    const settle = vi.fn(async () => {
      throw new Error('lost response')
    })
    const ledger = {
      reserve: vi.fn(async () => ({ ok: true as const, reservationId: 'r1' })),
      settle
    }
    const result = await runAi(
      { tenantId, callerKey: 'label:10', purpose: 'label', request },
      { ledger, env: live, fetch: vi.fn(async () => geminiOk()) }
    )
    expect(result).toMatchObject({ ok: true, settled: false })
    expect(settle).toHaveBeenCalledTimes(1)
  })

  it('refuses bad input before reserving or sending', async () => {
    const ledger = new InMemoryBudgetLedger(1_000_000)
    const fetch = vi.fn()
    for (const bad of [
      { tenantId: 'not-a-uuid', callerKey: 'x', maxOutputTokens: 10 },
      { tenantId, callerKey: '', maxOutputTokens: 10 },
      { tenantId, callerKey: 'x', maxOutputTokens: Number.NaN },
      { tenantId, callerKey: 'x', maxOutputTokens: 10_000_000 }
    ])
      expect(
        await runAi(
          {
            tenantId: bad.tenantId,
            callerKey: bad.callerKey,
            purpose: 'label',
            request: { ...request, maxOutputTokens: bad.maxOutputTokens }
          },
          { ledger, env: live, fetch }
        )
      ).toEqual({ ok: false, code: 'rejected_request' })
    expect(fetch).not.toHaveBeenCalled()
    expect(ledger.reservations.size).toBe(0)
  })

  it('sends pictures and reserves a fixed allowance per picture, not its byte size', async () => {
    const big = 'A'.repeat(3_000_000)
    const ledger = new InMemoryBudgetLedger(10_000_000)
    const fetch = vi.fn(async () => geminiOk())
    const result = await runAi(
      {
        tenantId,
        callerKey: 'label:img',
        purpose: 'label',
        request: {
          ...request,
          images: [{ mediaType: 'image/png', base64: big }]
        }
      },
      { ledger, env: live, fetch }
    )
    expect(result.ok).toBe(true)
    const sent = JSON.parse(
      String(
        (fetch.mock.calls as unknown[][])[0][1] &&
          ((fetch.mock.calls as unknown[][])[0][1] as RequestInit).body
      )
    )
    expect(sent.contents[0].parts[1].inlineData.data).toHaveLength(3_000_000)
    // 3M base64 bytes counted as tokens would reserve ~$0.30 on Flash-Lite;
    // the per-picture allowance keeps it under a cent.
    const reserved = [...ledger.reservations.values()][0]
    expect(reserved.estimateMicro).toBeLessThan(10_000)
  })

  it('sends and reserves the answer room plus the thinking budget', async () => {
    const ledger = new InMemoryBudgetLedger(10_000_000)
    const fetch = vi.fn(async () => geminiOk())
    const result = await runAi(
      {
        tenantId,
        callerKey: 'review:think',
        purpose: 'review',
        request: { ...request, reasoningEffort: 'medium' }
      },
      { ledger, env: live, fetch }
    )
    expect(result.ok).toBe(true)
    const body = String(
      ((fetch.mock.calls as unknown[][])[0][1] as RequestInit).body
    )
    expect(JSON.parse(body).generationConfig).toMatchObject({
      maxOutputTokens: 256 + 4_096,
      thinkingConfig: { thinkingBudget: 4_096 }
    })
    const reserved = [...ledger.reservations.values()][0]
    expect(reserved.estimateMicro).toBe(
      geminiEstimateMicro('gemini-2.5-flash', body, 256 + 4_096)
    )
  })

  it('refuses unsafe or too many pictures before reserving anything', async () => {
    const ledger = new InMemoryBudgetLedger(10_000_000)
    const fetch = vi.fn()
    for (const images of [
      [{ mediaType: 'image/gif', base64: 'R0lGODlhAQABAAAAACw=' }],
      [{ mediaType: 'image/png', base64: 'not base64!' }],
      Array.from({ length: 9 }, () => ({
        mediaType: 'image/png',
        base64: 'iVBORw0KGgoAAAA='
      }))
    ])
      expect(
        await runAi(
          {
            tenantId,
            callerKey: 'x',
            purpose: 'label',
            request: { ...request, images: images as never }
          },
          { ledger, env: live, fetch }
        )
      ).toEqual({ ok: false, code: 'rejected_request' })
    expect(fetch).not.toHaveBeenCalled()
    expect(ledger.reservations.size).toBe(0)
  })

  it('uses Flash for the review tier (second tries and inspectors)', async () => {
    const fetch = vi.fn(async () => geminiOk())
    await runAi(
      { tenantId, callerKey: 'review:1', purpose: 'review', request },
      { ledger: new InMemoryBudgetLedger(1_000_000), env: live, fetch }
    )
    expect(String((fetch.mock.calls as unknown[][])[0][0])).toContain(
      'gemini-2.5-flash:generateContent'
    )
  })

  it('reports an unsupported configured model without calling anything', async () => {
    const fetch = vi.fn()
    const result = await runAi(
      { tenantId, callerKey: 'copy:1', purpose: 'copy', request },
      {
        ledger: new InMemoryBudgetLedger(1_000_000),
        env: env({ GEMINI_API_KEY: 'test-key', GEMINI_COPY_MODEL: 'nope' }),
        fetch
      }
    )
    expect(result).toEqual({ ok: false, code: 'unsupported_model' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('SupabaseBudgetLedger', () => {
  it('maps the allowance check failure to cap_reached', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '23514', message: 'AI usage allowance reached' }
    }))
    const ledger = new SupabaseBudgetLedger({ rpc } as never)
    expect(
      await ledger.reserve({
        tenantId,
        operationId: 'label:8',
        feature: 'learning',
        estimateMicro: 100
      })
    ).toEqual({ ok: false, code: 'cap_reached' })
    expect(rpc).toHaveBeenCalledWith('reserve_ai_usage', {
      t: tenantId,
      operation: 'label:8',
      feature: 'learning',
      estimate: 100
    })
  })

  it('does not call other check violations "cap reached"', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '23514', message: 'Active package required' }
    }))
    expect(
      await new SupabaseBudgetLedger({ rpc } as never).reserve({
        tenantId,
        operationId: 'label:11',
        feature: 'learning',
        estimateMicro: 100
      })
    ).toEqual({ ok: false, code: 'ledger_unavailable' })
  })

  it('treats any other database error as the ledger being unavailable', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '42501', message: 'Access denied' }
    }))
    const ledger = new SupabaseBudgetLedger({ rpc } as never)
    expect(
      await ledger.reserve({
        tenantId,
        operationId: 'label:9',
        feature: 'learning',
        estimateMicro: 100
      })
    ).toEqual({ ok: false, code: 'ledger_unavailable' })
  })

  it('settles the rounded real cost', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    await new SupabaseBudgetLedger({ rpc } as never).settle({
      tenantId,
      reservationId: 'r1',
      actualMicro: 57.2
    })
    expect(rpc).toHaveBeenCalledWith('settle_ai_usage', {
      t: tenantId,
      reservation: 'r1',
      actual: 58
    })
  })

  it('routes platform work to the platform budget', async () => {
    const rpc = vi.fn(async (fn: string) => ({
      data: fn.startsWith('reserve') ? 'p1' : null,
      error: null
    }))
    const ledger = new SupabaseBudgetLedger({ rpc } as never)
    expect(
      await ledger.reserve({
        tenantId: null,
        operationId: 'ai:label:section-1:x',
        feature: 'learning',
        estimateMicro: 100
      })
    ).toEqual({ ok: true, reservationId: 'p1' })
    await ledger.settle({
      tenantId: null,
      reservationId: 'p1',
      actualMicro: 9.5
    })
    expect(rpc.mock.calls).toEqual([
      [
        'reserve_platform_ai_usage',
        {
          operation: 'ai:label:section-1:x',
          feature: 'learning',
          estimate: 100
        }
      ],
      ['settle_platform_ai_usage', { reservation: 'p1', actual: 10 }]
    ])
  })

  it('maps the platform cap message to cap_reached', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: '23514',
        message: 'Platform AI allowance reached; no AI request was sent'
      }
    }))
    expect(
      await new SupabaseBudgetLedger({ rpc } as never).reserve({
        tenantId: null,
        operationId: 'ai:label:s:y',
        feature: 'learning',
        estimateMicro: 100
      })
    ).toEqual({ ok: false, code: 'cap_reached' })
  })
})

describe('runAi platform work', () => {
  it('meters a competitor-section label against the platform, not a client', async () => {
    const ledger = new InMemoryBudgetLedger(1_000_000)
    const result = await runAi(
      { tenantId: null, callerKey: 'section:abc', purpose: 'label', request },
      { ledger, env: live, fetch: vi.fn(async () => geminiOk()) }
    )
    expect(result).toMatchObject({ ok: true, costMicro: 58 })
    expect(ledger.spentMicro(null)).toBe(58)
    expect(ledger.spentMicro(tenantId)).toBe(0)
  })
})

describe('the second provider (REL-PRV, off by default)', () => {
  const openai = (over: Record<string, string> = {}) =>
    env({ AI_V2_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key', ...over })
  const answer = (over: Record<string, unknown> = {}) =>
    new Response(
      JSON.stringify({
        id: 'resp_1',
        model: 'gpt-6-luna',
        status: 'completed',
        usage: { input_tokens: 1000, output_tokens: 100 },
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '{"block":"hero_product"}' }]
          }
        ],
        ...over
      }),
      { status: 200 }
    )
  const call = (
    fetch: ReturnType<typeof vi.fn>,
    over: Partial<typeof request> & Record<string, unknown> = {}
  ) => {
    const ledger = new InMemoryBudgetLedger(1_000_000)
    return {
      ledger,
      result: runAi(
        {
          tenantId,
          callerKey: 'label:openai',
          purpose: 'label',
          request: { ...request, ...over }
        },
        {
          ledger,
          env: openai(),
          fetch: fetch as unknown as typeof globalThis.fetch
        }
      )
    }
  }
  const sentBody = (fetch: ReturnType<typeof vi.fn>) =>
    JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body))

  it('is chosen only by its own switch: never by an OpenAI key, nor by an older AI_DEFAULT_PROVIDER value', () => {
    expect(aiSetup('copy', env({ OPENAI_API_KEY: 'k' }))).toMatchObject({
      provider: 'fake',
      reason: 'missing_key'
    })
    for (const value of ['openai', 'gemini', 'anthropic'])
      expect(
        aiSetup(
          'copy',
          env({
            AI_DEFAULT_PROVIDER: value,
            OPENAI_API_KEY: 'k',
            GEMINI_API_KEY: 'g'
          })
        ),
        value
      ).toMatchObject({ provider: 'gemini' })
    expect(aiSetup('copy', openai())).toMatchObject({
      ready: true,
      provider: 'openai',
      model: 'gpt-6.1-terra',
      baseUrl: openAiBaseUrl
    })
    // Forcing the fake always wins (tests and Claude sessions).
    expect(
      aiSetup('copy', openai({ AI_DEFAULT_PROVIDER: 'fake' }))
    ).toMatchObject({ provider: 'fake', reason: 'fake_selected' })
    // Its address is fixed: a configured one is never used.
    expect(
      aiSetup(
        'copy',
        openai({ OPENAI_BASE_URL: 'https://proxy.example.com/v1' })
      )
    ).toMatchObject({ baseUrl: openAiBaseUrl })
  })

  it('answers with the fake without its key, and fails closed on an unpriced model', () => {
    expect(aiSetup('copy', env({ AI_V2_PROVIDER: 'openai' }))).toMatchObject({
      provider: 'fake',
      reason: 'missing_key'
    })
    expect(aiSetup('label', openai())).toMatchObject({ model: 'gpt-6-luna' })
    expect(
      aiSetup('plan', openai({ OPENAI_PLAN_MODEL: 'gpt-6-luna' }))
    ).toMatchObject({ model: 'gpt-6-luna' })
    expect(
      aiSetup('copy', openai({ OPENAI_COPY_MODEL: 'gpt-unpriced' }))
    ).toEqual({ ready: false, provider: 'openai', reason: 'unsupported_model' })
    expect(aiAvailability('copy', openai())).toEqual({
      live: true,
      provider: 'openai',
      model: 'gpt-6.1-terra',
      reason: null
    })
    expect(aiTakesPictures('label', openai())).toBe(false)
    expect(aiTakesPictures('label', live)).toBe(true)
  })

  it('caps every provider’s call time for a job', () => {
    const capped = cappedAiEnv(
      'label',
      openai({ OPENAI_TIMEOUT_MS: '90000', GEMINI_TIMEOUT_MS: '90000' }),
      10_000
    )
    expect(capped.OPENAI_TIMEOUT_MS).toBe('10000')
    expect(capped.GEMINI_TIMEOUT_MS).toBe('10000')
    expect(aiSetup('label', capped)).toMatchObject({ timeoutMs: 10_000 })
  })

  it('sends a call to its official address with the body it priced, and records the real cost', async () => {
    const fetch = vi.fn(async () => answer())
    const { ledger, result } = call(fetch, { reasoningEffort: 'low' })
    await result
    const [sentUrl, sentInit] = (
      fetch.mock.calls as unknown as [string, RequestInit][]
    )[0]
    expect(sentUrl).toBe(`${openAiBaseUrl}/responses`)
    expect((sentInit.headers as Record<string, string>).authorization).toBe(
      'Bearer test-key'
    )
    const body = sentBody(fetch)
    // Answer room plus thinking room; schemas as a guide; the standard tier.
    expect(body).toMatchObject({
      max_output_tokens: request.maxOutputTokens + 1_024,
      service_tier: 'default',
      text: { format: { strict: false } }
    })
    // 1,000 input at $0.10/M + 100 output at $0.50/M = 100 + 50 micro-USD.
    expect(await result).toMatchObject({
      ok: true,
      provider: 'openai',
      model: 'gpt-6-luna',
      costMicro: 150,
      content: { block: 'hero_product' }
    })
    expect(ledger.spentMicro(tenantId)).toBe(150)
    const reserved = [...ledger.reservations.values()][0]
    expect(reserved.estimateMicro).toBe(
      estimateMicro(
        'gpt-6-luna',
        String(sentInit.body),
        request.maxOutputTokens + 1_024
      )
    )
  })

  it('settles what its failures cost: nothing when refused, the usage when cut short, the ceiling when unknown', async () => {
    const busy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'rate_limit_exceeded' } }),
          { status: 429, headers: { 'retry-after': '20' } }
        )
    )
    const one = call(busy)
    expect(await one.result).toMatchObject({ ok: false, code: 'rate_limited' })
    expect(one.ledger.spentMicro(tenantId)).toBe(0)

    const cut = vi.fn(async () =>
      answer({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        usage: { input_tokens: 1000, output_tokens: 200 }
      })
    )
    const two = call(cut)
    expect(await two.result).toMatchObject({ ok: false, code: 'incomplete' })
    // 1,000 input at $0.10/M + 200 output at $0.50/M = 100 + 100.
    expect(two.ledger.spentMicro(tenantId)).toBe(200)

    const down = vi.fn(async () => new Response('oops', { status: 500 }))
    const three = call(down)
    expect(await three.result).toMatchObject({ ok: false })
    const estimate = [...three.ledger.reservations.values()][0].estimateMicro
    expect(three.ledger.spentMicro(tenantId)).toBe(estimate)
  })

  it('refuses before reserving or sending: pictures, a request too large, no answer shape', async () => {
    for (const [over, diagnostic] of [
      [
        {
          images: [
            { mediaType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUg==' }
          ]
        },
        'images_unsupported'
      ],
      [{ user: 'x'.repeat(260_000) }, 'request_too_large'],
      [{ schema: undefined }, 'schema_required']
    ] as const) {
      const fetch = vi.fn()
      const { ledger, result } = call(fetch, over as never)
      expect(await result, diagnostic).toMatchObject({
        ok: false,
        code: 'rejected_request',
        diagnostic
      })
      expect(fetch).not.toHaveBeenCalled()
      expect(ledger.reservations.size).toBe(0)
    }
  })
})
