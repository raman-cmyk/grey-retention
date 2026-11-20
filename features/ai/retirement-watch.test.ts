// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  modelRetirements,
  pricedModels,
  type Retirement
} from '@/lib/providers/model-retirements'
import {
  modelsInUse,
  modelsInUseNow,
  recheckDays,
  retirementWatch,
  warnDays
} from './retirement-watch'

/** Owner pick #83: the model retirement watch. */
const env = (values: Record<string, string>) =>
  values as unknown as NodeJS.ProcessEnv
const flash = {
  provider: 'gemini' as const,
  model: 'gemini-2.5-flash',
  purposes: ['copy' as const, 'review' as const]
}
const table = (r: Partial<Retirement>): Record<string, Retirement> => ({
  'gemini-2.5-flash': {
    provider: 'gemini',
    shutdownOn: null,
    checkedOn: null,
    ...r
  }
})

describe('the model retirement watch (owner pick #83)', () => {
  it('has a line for every model the price tables allow, and only those', () => {
    const priced = [...pricedModels.gemini, ...pricedModels.openai].sort()
    expect(Object.keys(modelRetirements).sort()).toEqual(priced)
    for (const model of pricedModels.gemini)
      expect(modelRetirements[model].provider).toBe('gemini')
    for (const model of pricedModels.openai)
      expect(modelRetirements[model].provider).toBe('openai')
    // Dates as YYYY-MM-DD, never a guess in another form.
    for (const r of Object.values(modelRetirements))
      for (const date of [r.shutdownOn, r.checkedOn])
        if (date) expect(date).toMatch(/^\d{4}-\d\d-\d\d$/)
  })

  it('lists the models the app would call, with what each is used for; the fake calls none', () => {
    expect(modelsInUseNow(env({ AI_DEFAULT_PROVIDER: 'fake' }))).toEqual([])
    expect(modelsInUseNow(env({}))).toEqual([])
    expect(modelsInUseNow(env({ GEMINI_API_KEY: 'k' }))).toEqual([
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
        purposes: ['label']
      },
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        purposes: ['copy', 'review']
      },
      { provider: 'gemini', model: 'gemini-2.5-pro', purposes: ['plan'] }
    ])
    expect(
      modelsInUseNow(
        env({ AI_V2_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })
      ).map((m) => m.model)
    ).toEqual(['gpt-6-luna', 'gpt-6.1-terra'])
    // A setup that is not ready (a model off the price table) calls none.
    expect(
      modelsInUse({
        label: { ready: false, provider: 'gemini' },
        copy: { ready: true, provider: 'fake', model: 'fake' },
        review: { ready: true, provider: 'gemini', model: 'gemini-2.5-flash' },
        plan: { ready: true, provider: 'gemini', model: 'gemini-2.5-flash' }
      })
    ).toEqual([
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        purposes: ['review', 'plan']
      }
    ])
  })

  it('warns six weeks before a shutdown, and says what to change', () => {
    const shut = table({
      shutdownOn: '2027-01-31',
      replacement: 'gemini-3-flash'
    })
    const [soon] = retirementWatch([flash], '2027-01-01', shut)
    expect(warnDays).toBe(42)
    expect(soon).toMatchObject({ state: 'soon' })
    expect(soon!.detail).toBe(
      'Shuts down on 2027-01-31, in 30 days (used for writing, checking): move GEMINI_COPY_MODEL, GEMINI_REVIEW_MODEL to gemini-3-flash before then.'
    )
    expect(retirementWatch([flash], '2026-12-20', shut)[0]!.state).toBe('soon')
    const far = retirementWatch([flash], '2026-11-01', shut)[0]!
    expect(far).toMatchObject({ state: 'ok' })
    expect(far.detail).toBe(
      'Shuts down on 2027-01-31, in 91 days (used for writing, checking).'
    )
  })

  it('says a model already shut down fails, on its last day and after', () => {
    const shut = table({ shutdownOn: '2027-01-31' })
    for (const today of ['2027-01-31', '2027-03-01']) {
      const [line] = retirementWatch([flash], today, shut)
      expect(line).toMatchObject({ state: 'retired' })
      expect(line!.detail).toBe(
        'Shut down on 2027-01-31: its calls for writing, checking fail and fall back. Move GEMINI_COPY_MODEL, GEMINI_REVIEW_MODEL to another model in its price table.'
      )
    }
  })

  it('never calls a model safe whose date no one checked lately', () => {
    const [never] = retirementWatch([flash], '2027-01-01', table({}))
    expect(never).toMatchObject({ state: 'unknown' })
    expect(never!.detail).toBe(
      'Its shutdown date has never been checked (used for writing, checking): read https://ai.google.dev/gemini-api/docs/deprecations and update lib/providers/model-retirements.ts.'
    )
    expect(recheckDays).toBe(90)
    const fresh = retirementWatch(
      [flash],
      '2027-01-01',
      table({ checkedOn: '2026-12-01' })
    )[0]!
    expect(fresh).toMatchObject({
      state: 'ok',
      detail:
        'No shutdown announced when checked on 2026-12-01 (used for writing, checking).'
    })
    const stale = retirementWatch(
      [flash],
      '2027-06-01',
      table({ checkedOn: '2026-12-01' })
    )[0]!
    expect(stale.state).toBe('unknown')
    expect(stale.detail).toMatch(
      /^Its shutdown date was last checked on 2026-12-01/
    )
    // A model with no line at all is unknown too.
    expect(
      retirementWatch([{ ...flash, model: 'gemini-9' }], '2027-01-01', {})[0]!
        .state
    ).toBe('unknown')
  })

  it('names the second provider’s settings and page for its models', () => {
    const [line] = retirementWatch(
      [{ provider: 'openai', model: 'gpt-6-luna', purposes: ['label'] }],
      '2027-01-01'
    )
    expect(line!.detail).toContain(
      'https://platform.openai.com/docs/deprecations'
    )
    const shut = retirementWatch(
      [{ provider: 'openai', model: 'gpt-6-luna', purposes: ['label'] }],
      '2027-01-01',
      {
        'gpt-6-luna': {
          provider: 'openai',
          shutdownOn: '2027-01-10',
          checkedOn: '2026-12-01'
        }
      }
    )[0]!
    expect(shut.detail).toContain('move OPENAI_LABEL_MODEL to another model')
  })
})
