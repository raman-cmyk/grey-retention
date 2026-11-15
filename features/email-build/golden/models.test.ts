// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import { goldenBriefs, goldenNow, type GoldenBrief } from './briefs'
import { fakeModel, type FakeModelKind } from './fake-model'
import { goldenProblems, type GoldenRun } from './properties'
import { runGolden } from './run'

/**
 * REL-EVL part 2: the golden set on the agent path, with scripted fake
 * models (`fake-model.ts`; no provider is called). Each model builds the
 * ten briefs as one plan, and every email must pass the same properties
 * as on the code path. `rounds` is the careful model on a clock where
 * each call takes 20 s, so the copy step saves its rounds between claims
 * and goes on from them, as the job does.
 */
type Mode = FakeModelKind | 'rounds'
type ModeRun = { brief: GoldenBrief; run: GoldenRun; log: InMemoryRunLog }

/** Each call moves the clock on by `step` ms. */
const timed =
  (ai: AiCall, clock: { t: number }, step: number): AiCall =>
  async (call) => {
    clock.t += step
    return ai(call)
  }

async function runMode(mode: Mode): Promise<ModeRun[]> {
  const taken: string[] = []
  const out: ModeRun[] = []
  for (const brief of goldenBriefs) {
    const log = new InMemoryRunLog()
    const clock = { t: goldenNow }
    const ai =
      mode === 'rounds'
        ? timed(fakeModel('careful'), clock, 20_000)
        : fakeModel(mode)
    const run = await runGolden(brief, {
      agents: { memory: new InMemoryMemoryStore(), log, ai },
      fallbacks: memoryFallbackLog(),
      taken: [...taken],
      ...(mode === 'rounds'
        ? { clock: () => clock.t, until: () => clock.t + 50_000 }
        : {})
    })
    if (run.result.ok) taken.push(run.result.email.subject)
    out.push({ brief, run, log })
  }
  return out
}

const modes: Mode[] = ['careful', 'careless', 'stubborn', 'fixture', 'rounds']
const runs = new Map<Mode, Promise<ModeRun[]>>()
const modeRuns = (mode: Mode) => {
  if (!runs.has(mode)) runs.set(mode, runMode(mode))
  return runs.get(mode)!
}
const built = (r: ModeRun) => (r.run.result.ok ? r.run.result.email : null)
const calls = (r: ModeRun, agent: string) =>
  r.log.entries.filter((e) => e.agent === agent).length
const reasons = (r: ModeRun) => r.run.fallbacks.map((f) => f.reasonCode)
/** Code's own reasons, which any model gets: a product or offer it could not use. */
const otherReasons = (r: ModeRun) =>
  reasons(r).filter((c) => c !== 'content_replaced')

describe('the golden set with scripted fake models (REL-EVL part 2)', () => {
  describe.each(modes)('the %s model', (mode) => {
    it.each(goldenBriefs.map((b) => [b.id] as const))(
      '%s: every property holds',
      async (id) => {
        const r = (await modeRuns(mode)).find((x) => x.brief.id === id)!
        expect(goldenProblems(r.brief, r.run)).toEqual([])
      }
    )

    it('gives every email of the plan its own subject', async () => {
      const subjects = (await modeRuns(mode)).map((r) =>
        built(r)?.subject.toLowerCase()
      )
      expect(subjects).not.toContain(undefined)
      expect(new Set(subjects).size).toBe(goldenBriefs.length)
    })
  })

  it('a careful model writes every email on its first try, and nothing else is logged', async () => {
    for (const r of await modeRuns('careful')) {
      expect(built(r)).toMatchObject({ ai: true, copy: 'written' })
      expect(calls(r, 'copywriter')).toBe(1)
      expect(otherReasons(r)).toEqual([])
    }
  })

  it('a careless model is caught by each check in turn and fixes what it found', async () => {
    for (const r of await modeRuns('careless')) {
      expect(built(r)).toMatchObject({ ai: true, copy: 'written' })
      // Its claims (the copy checks), then its voice (the inspectors).
      expect(calls(r, 'copywriter')).toBe(3)
      // A plan without the logo (the sections check).
      expect(calls(r, 'section-planner')).toBe(2)
      expect(otherReasons(r)).toEqual([])
    }
    // A made-up product (the placement check), where there are products.
    const placed = (await modeRuns('careless')).filter(
      (r) => calls(r, 'content-locker') > 0
    )
    expect(placed.length).toBeGreaterThan(0)
    for (const r of placed) expect(calls(r, 'content-locker')).toBe(2)
  })

  it('a model that never drops its template tag gives plain copy, logged', async () => {
    for (const r of await modeRuns('stubborn')) {
      expect(built(r)?.copy).toBe('plain')
      expect(otherReasons(r)).toEqual(['copy_plain_fallback'])
    }
  })

  it('a model that answers like the repo’s fake leaves every step to code, logged, and the email says the AI was not used', async () => {
    for (const r of await modeRuns('fixture')) {
      expect(built(r)).toMatchObject({ ai: false, copy: 'plain' })
      expect(reasons(r)).toEqual(
        expect.arrayContaining([
          'sections_answer_invalid',
          'copy_plain_fallback'
        ])
      )
    }
  })

  it('saved rounds between claims make the same emails as one claim, with no call twice', async () => {
    const careful = await modeRuns('careful')
    const rounds = await modeRuns('rounds')
    rounds.forEach((r, i) => {
      expect(r.run.result).toEqual(careful[i].run.result)
      expect(r.log.entries.map((e) => e.agent)).toEqual(
        careful[i].log.entries.map((e) => e.agent)
      )
    })
    expect(rounds.every((r) => (r.run.saves ?? 0) >= 1)).toBe(true)
  })
})
