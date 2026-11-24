// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog } from '@/features/agents/runtime'
import { InMemoryBudgetLedger } from '@/features/ai/budget-ledger'
import { runAi } from '@/features/ai/run'
import { aiSetup } from '@/features/ai/setup'
import { memoryFallbackLog } from '@/features/fallback/log'
import { agentEnv } from '../agents'
import { goldenBriefs, goldenNow, goldenTenantId } from './briefs'
import { goldenProblems, type GoldenRun } from './properties'
import { runGolden } from './run'

/**
 * AI-MDL-001: the golden set on a live Gemini model, for a run the owner
 * has said yes to (paid AI). Skipped unless `LIVE_GEMINI=on`; it needs
 * `GEMINI_API_KEY` and, on Node's own fetch behind a proxy,
 * `NODE_USE_ENV_PROXY=1`. Each brief is built twice: on the code path (what
 * the app makes with the agents off) and on the agent path as "Create
 * email" runs it (`buildAgentsFor`: every call capped at `agentCallMs`),
 * metered against an in-memory allowance of `LIVE_CAP_MICRO` (default
 * $5) instead of a workspace's package, so nothing is written anywhere.
 * Model names come from the usual settings (`GEMINI_COPY_MODEL` …).
 * The report, each call's failure and every email's HTML go to `LIVE_OUT`
 * (default: a `live-golden` folder in the system's temp folder).
 */
const live = process.env.LIVE_GEMINI === 'on'
const out = process.env.LIVE_OUT ?? join(tmpdir(), 'live-golden')

/** The spending cap in micro-USD; anything but a positive whole number stops the run. */
function capFrom(value: string | undefined) {
  if (value === undefined) return 5_000_000
  const cap = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN
  if (!Number.isSafeInteger(cap) || cap < 1)
    throw new Error(
      'LIVE_CAP_MICRO must be a whole number of micro-dollars, e.g. 5000000 for $5'
    )
  return cap
}

const summary = (run: GoldenRun) =>
  run.result.ok
    ? {
        ok: true,
        ai: run.result.email.ai,
        copy: run.result.email.copy,
        format: run.result.email.format ?? null,
        subject: run.result.email.subject,
        preheader: run.result.email.preheader,
        code: run.result.email.code,
        products: run.result.email.productIds,
        families: run.sections?.families ?? null
      }
    : { ok: false, code: run.result.code }

describe.skipIf(!live)('the golden set on live Gemini (AI-MDL-001)', () => {
  it('builds each brief on the code path and the agent path', async () => {
    const capMicro = capFrom(process.env.LIVE_CAP_MICRO)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AI_DEFAULT_PROVIDER: '',
      AI_V2_PROVIDER: '',
      EMAIL_BUILD_AGENTS: 'on'
    }
    const setups = (['label', 'copy', 'plan', 'review'] as const).map(
      (p) => [p, aiSetup(p, env)] as const
    )
    // A run without a live model would build every email on the fake.
    for (const [purpose, s] of setups)
      if (s.provider !== 'gemini' || !s.ready)
        throw new Error(
          `No live Gemini model for ${purpose}: set GEMINI_API_KEY`
        )
    const models = Object.fromEntries(
      setups.map(([p, s]) => [p, 'model' in s ? s.model : '?'])
    )
    mkdirSync(join(out, 'html'), { recursive: true })
    writeFileSync(join(out, 'errors.jsonl'), '')
    const capped = agentEnv(env)
    const ledger = new InMemoryBudgetLedger(capMicro)
    const report: unknown[] = []
    const takenCode: string[] = []
    const takenAi: string[] = []
    for (const brief of goldenBriefs) {
      const codeRun = await runGolden(brief, {
        agents: null,
        fallbacks: memoryFallbackLog(),
        taken: [...takenCode],
        clock: () => goldenNow
      })
      if (codeRun.result.ok) takenCode.push(codeRun.result.email.subject)
      const log = new InMemoryRunLog()
      const started = Date.now()
      const aiRun = await runGolden(brief, {
        agents: {
          memory: new InMemoryMemoryStore(),
          log,
          ai: async (call) => {
            const r = await runAi(call, { ledger, env: capped })
            if (!r.ok)
              writeFileSync(
                join(out, 'errors.jsonl'),
                JSON.stringify({
                  brief: brief.id,
                  callerKey: call.callerKey,
                  purpose: call.purpose,
                  code: r.code,
                  diagnostic: r.diagnostic ?? null
                }) + '\n',
                { flag: 'a' }
              )
            return r
          }
        },
        fallbacks: memoryFallbackLog(),
        taken: [...takenAi],
        clock: () => goldenNow
      })
      if (aiRun.result.ok) takenAi.push(aiRun.result.email.subject)
      for (const [kind, run] of [
        ['code', codeRun],
        ['ai', aiRun]
      ] as const)
        if (run.result.ok)
          writeFileSync(
            join(out, 'html', `${brief.id}.${kind}.html`),
            run.result.email.html
          )
      report.push({
        id: brief.id,
        seconds: Math.round((Date.now() - started) / 1000),
        code: summary(codeRun),
        codeProblems: goldenProblems(brief, codeRun),
        agents: summary(aiRun),
        agentProblems: goldenProblems(brief, aiRun),
        fallbacks: aiRun.fallbacks.map((f) => f.reasonCode),
        calls: log.entries.map((e) => ({
          agent: e.agent,
          model: e.model,
          verdict: e.verdict,
          detail: e.detail,
          costMicro: e.costMicro
        })),
        spentMicroSoFar: ledger.spentMicro(goldenTenantId)
      })
      writeFileSync(
        join(out, 'report.json'),
        JSON.stringify({ models, capMicro, report }, null, 2)
      )
    }
  }, 3_600_000)
})
