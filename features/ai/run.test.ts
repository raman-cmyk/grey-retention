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

  it('accepts the older Google key name', () => {
    expect(
      aiSetup('label', env({ GOOGLE_GENERATIVE_AI_KEY: 'old-key' }))
    ).toMatchObject({ provider: 'gemini', apiKey: 'old-key' })
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
      { tenantId, operationId: 'label:1', purpose: 'label', request },
      { ledger, env: env({}) }
    )
    expect(result).toMatchObject({ ok: true, provider: 'fake', costMicro: 0 })
    expect(ledger.reservations.size).toBe(0)
  })

  it('sends a labelling call to Flash-Lite and records its real cost', async () => {
    const ledger = new InMemoryBudgetLedger(1_000_000)
    const fetch = vi.fn(async () => geminiOk())
    const result = await runAi(
      { tenantId, operationId: 'label:2', purpose: 'label', request },
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
      { tenantId, operationId: 'label:3', purpose: 'label', request },
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
      { tenantId, operationId: 'label:4', purpose: 'label', request },
      { ledger, env: live, fetch: vi.fn(async () => geminiOk()) }
    )
    expect(result.ok).toBe(true)
  })

  it('settles zero for a provably unbilled failure, and the estimate when unknown', async () => {
    const ledger = new InMemoryBudgetLedger(1_000_000)
    const rateLimited = await runAi(
      { tenantId, operationId: 'label:5', purpose: 'label', request },
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
      { tenantId, operationId: 'label:6', purpose: 'label', request },
      {
        ledger,
        env: live,
        fetch: vi.fn(async () => new Response('{}', { status: 503 }))
      }
    )
    expect(down).toMatchObject({ ok: false, code: 'unavailable' })
    const reserved = ledger.reservations.get(`${tenantId}:label:6`)!
    expect(reserved.actualMicro).toBe(reserved.estimateMicro)
  })

  it('reuses the reservation when the same operation is retried', async () => {
    const ledger = new InMemoryBudgetLedger(1_000_000)
    const deps = { ledger, env: live, fetch: vi.fn(async () => geminiOk()) }
    const input = {
      tenantId,
      operationId: 'label:7',
      purpose: 'label' as const,
      request
    }
    await runAi(input, deps)
    await runAi(input, deps)
    expect(ledger.reservations.size).toBe(1)
  })

  it('reports an unsupported configured model without calling anything', async () => {
    const fetch = vi.fn()
    const result = await runAi(
      { tenantId, operationId: 'copy:1', purpose: 'copy', request },
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
    expect(rpc).toHaveBeenCalledWith('reserve_fixture_usage', {
      t: tenantId,
      operation: 'label:8',
      feature: 'learning',
      estimate: 100
    })
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
    expect(rpc).toHaveBeenCalledWith('reconcile_fixture_usage', {
      t: tenantId,
      reservation: 'r1',
      actual: 58
    })
  })
})
