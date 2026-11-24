// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  modelRetirements,
  pricedModels,
  type Retirement
} from '@/lib/providers/model-retirements'
import {
  isRealDay,
  modelsInUse,
  modelsInUseNow,
  recheckDays,
  retirementWatch,
  warnDays,
  type ModelInUse
} from './retirement-watch'

/** Owner pick #83: the model retirement watch. */
const env = (values: Record<string, string>) =>
  values as unknown as NodeJS.ProcessEnv
const flash: ModelInUse = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  purposes: ['copy', 'review']
}
const watch = (
  today: string,
  r: Partial<Retirement> | null,
  m: ModelInUse = flash
) =>
  retirementWatch(
    { inUse: [m], unpriced: [] },
    today,
    r
      ? {
          [m.model]: {
            provider: m.provider,
            shutdownOn: null,
            checkedOn: null,
            ...r
          }
        }
      : {}
  )[0]!
const tenant = '00000000-0000-4000-8000-000000000101'

describe('the model retirement watch (owner pick #83)', () => {
  it('has a line for every model the price tables allow, each date a real day', () => {
    const priced = [...pricedModels.gemini, ...pricedModels.openai].sort()
    expect(Object.keys(modelRetirements).sort()).toEqual(priced)
    for (const model of pricedModels.gemini)
      expect(modelRetirements[model].provider).toBe('gemini')
    for (const model of pricedModels.openai)
      expect(modelRetirements[model].provider).toBe('openai')
    for (const r of Object.values(modelRetirements)) {
      for (const date of [r.shutdownOn, r.checkedOn])
        if (date) expect(isRealDay(date), date).toBe(true)
      if (r.replacement) expect(priced, r.replacement).toContain(r.replacement)
    }
    expect(isRealDay('2027-02-28')).toBe(true)
    for (const bad of ['2027-13-01', '2027-02-30', '27-01-01', ''])
      expect(isRealDay(bad), bad).toBe(false)
  })

  it('lists the models GROS would call, with what each is used for; the fake calls none', () => {
    expect(modelsInUseNow(env({ AI_DEFAULT_PROVIDER: 'fake' }))).toEqual({
      inUse: [],
      unpriced: []
    })
    expect(modelsInUseNow(env({})).inUse).toEqual([])
    expect(modelsInUseNow(env({ GEMINI_API_KEY: 'k' })).inUse).toEqual([
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
        purposes: ['label']
      },
      {
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        purposes: ['copy', 'review']
      },
      { provider: 'gemini', model: 'gemini-3.8-flash', purposes: ['plan'] }
    ])
    expect(
      modelsInUseNow(
        env({ AI_V2_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })
      ).inUse.map((m) => m.model)
    ).toEqual(['gpt-6-luna', 'gpt-6.1-terra'])
  })

  it('lists the older rewriting’s model when a workspace has it on', () => {
    const on = env({
      AI_DEFAULT_PROVIDER: 'fake',
      OPENAI_API_KEY: 'k',
      SUPABASE_SERVICE_ROLE_KEY: 's',
      EMAIL_REWRITE_TENANT_IDS: tenant
    })
    expect(modelsInUseNow(on).inUse).toEqual([
      { provider: 'openai', model: 'gpt-6.1-terra', purposes: ['rewrite'] }
    ])
    // Its key with no workspace on: not in use.
    expect(
      modelsInUseNow(
        env({
          AI_DEFAULT_PROVIDER: 'fake',
          OPENAI_API_KEY: 'k',
          SUPABASE_SERVICE_ROLE_KEY: 's'
        })
      ).inUse
    ).toEqual([])
    // The sample writer is no model.
    expect(
      modelsInUseNow(
        env({
          AI_DEFAULT_PROVIDER: 'fake',
          EMAIL_REWRITE_PROVIDER: 'sample',
          SUPABASE_SERVICE_ROLE_KEY: 's'
        })
      ).inUse
    ).toEqual([])
  })

  it('names a purpose set to a model off the price table: its calls fail', () => {
    const input = modelsInUseNow(
      env({ GEMINI_API_KEY: 'k', GEMINI_COPY_MODEL: 'gemini-9-ultra' })
    )
    expect(input.unpriced).toEqual([{ provider: 'gemini', purpose: 'copy' }])
    expect(input.inUse.map((m) => m.purposes)).toEqual([
      ['label'],
      ['review'],
      ['plan']
    ])
    expect(retirementWatch(input, '2027-01-01')[0]).toEqual({
      name: 'GEMINI_COPY_MODEL',
      state: 'unpriced',
      detail:
        'Set to a model that is not in the price table, so every call for writing fails. Set it to a model the table lists.'
    })
    expect(
      modelsInUse({
        label: {
          ready: false,
          provider: 'gemini',
          reason: 'unsupported_model'
        },
        copy: { ready: true, provider: 'fake', model: 'fake' }
      })
    ).toEqual({
      inUse: [],
      unpriced: [{ provider: 'gemini', purpose: 'label' }]
    })
  })

  it('warns six weeks before a shutdown, and says what to change', () => {
    const shut = { shutdownOn: '2027-01-31', replacement: 'gemini-2.5-pro' }
    expect(warnDays).toBe(42)
    expect(watch('2027-01-01', shut)).toEqual({
      name: 'gemini-2.5-flash',
      state: 'soon',
      detail:
        'Shuts down on 2027-01-31, in 30 days (used for writing, checking): move GEMINI_COPY_MODEL, GEMINI_REVIEW_MODEL (or the default the code uses for them) to gemini-2.5-pro before then.'
    })
    expect(watch('2027-01-30', shut).detail).toMatch(/in 1 day \(used/)
    // 42 days out is soon; 43 is not yet.
    expect(watch('2026-12-20', shut).state).toBe('soon')
    expect(watch('2026-12-19', shut)).toMatchObject({
      state: 'ok',
      detail:
        'Shuts down on 2027-01-31, in 43 days (used for writing, checking).'
    })
    // A replacement off the price table is said to need adding first.
    expect(
      watch('2027-01-01', { ...shut, replacement: 'gemini-9' }).detail
    ).toContain('to gemini-9 (add it to the price table first) before then')
  })

  it('says a model already shut down fails, on its last day and after', () => {
    for (const today of ['2027-01-31', '2027-03-01'])
      expect(watch(today, { shutdownOn: '2027-01-31' })).toEqual({
        name: 'gemini-2.5-flash',
        state: 'retired',
        detail:
          'Shut down on 2027-01-31: its calls for writing, checking fail and fall back. Move GEMINI_COPY_MODEL, GEMINI_REVIEW_MODEL (or the default the code uses for them) to another model in its price table.'
      })
  })

  it('never calls a model safe whose date no one checked lately, or whose date is no real day', () => {
    expect(watch('2027-01-01', {})).toMatchObject({
      state: 'unknown',
      detail:
        'Its shutdown date has never been checked (used for writing, checking): read https://ai.google.dev/gemini-api/docs/deprecations and update lib/providers/model-retirements.ts.'
    })
    expect(recheckDays).toBe(90)
    const checked = { checkedOn: '2026-12-01' }
    expect(watch('2027-01-01', checked)).toMatchObject({
      state: 'ok',
      detail:
        'No shutdown announced when checked on 2026-12-01 (used for writing, checking).'
    })
    // 90 days after the check is trusted; 91 is not.
    expect(watch('2027-03-01', checked).state).toBe('ok')
    expect(watch('2027-03-02', checked)).toMatchObject({
      state: 'unknown',
      detail: expect.stringMatching(
        /^Its shutdown date was last checked on 2026-12-01/
      )
    })
    // A check dated after today is a typo, not a check.
    expect(watch('2027-01-01', { checkedOn: '2027-06-01' }).state).toBe(
      'unknown'
    )
    for (const shutdownOn of ['2027-13-01', '2027-02-30'])
      expect(watch('2027-01-01', { shutdownOn }), shutdownOn).toMatchObject({
        state: 'unknown',
        detail: expect.stringMatching(
          /^Its shutdown date in the table is not a real day/
        )
      })
    // A model with no line at all is unknown too.
    expect(watch('2027-01-01', null).state).toBe('unknown')
  })

  it('names the second provider’s settings and page for its models', () => {
    const luna: ModelInUse = {
      provider: 'openai',
      model: 'gpt-6-luna',
      purposes: ['label']
    }
    expect(watch('2027-01-01', {}, luna).detail).toContain(
      'https://platform.openai.com/docs/deprecations'
    )
    expect(
      watch('2027-01-01', { shutdownOn: '2027-01-10' }, luna).detail
    ).toContain(
      'move OPENAI_LABEL_MODEL (or the default the code uses for it) to another model'
    )
    const rewrite: ModelInUse = {
      provider: 'openai',
      model: 'gpt-6.1-terra',
      purposes: ['rewrite']
    }
    expect(
      watch('2027-01-01', { shutdownOn: '2027-01-10' }, rewrite).detail
    ).toMatch(/used for the older email rewriting\): move OPENAI_REWRITE_MODEL/)
  })
})
