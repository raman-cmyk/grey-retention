// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { runAi } from './run'
import { aiAvailability, aiSetup } from './setup'
import { InMemoryBudgetLedger, SupabaseBudgetLedger } from './budget-ledger'

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
