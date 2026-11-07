// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { ImageFetcher } from '@/lib/providers/image-fetch'
import {
  confirmSubscriptions,
  sampleLinkClicker,
  type LinkClicker
} from './confirm'

type Message = {
  confirm_url: string | null
  capture_id: string | null
  synthetic?: boolean
  /** What the click log already says for this email (a retry). */
  logged?: 'attempted' | 'clicked' | 'failed' | 'refused'
  /** A read that fails. */
  broken?: 'log' | 'message' | 'brand'
}

/** A stand-in for the confirm jobs, the inbox tables and the RPCs. */
function database(
  messages: Record<string, Message>,
  options: {
    recordError?: { code: string; message: string }
    /** begin_confirmation_click answers false (someone began it already). */
    begun?: false
  } = {}
) {
  const jobs = Object.keys(messages)
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const brands: Record<string, { domain: string; senders: string[] }> = {
    northwind: {
      domain: 'northwind.com',
      senders: ['mailer.northwind-news.com']
    }
  }
  const fault = { code: 'XX000', message: 'read failed' }
  return {
    calls,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (name === 'claim_platform_job') {
        const id = jobs.shift()
        return {
          data: id
            ? [{ id: `job-${id}`, lease_token: 'lease', subject_key: id }]
            : [],
          error: null
        }
      }
      if (name === 'begin_confirmation_click')
        return { data: options.begun ?? true, error: null }
      if (name === 'record_confirmation_click' && options.recordError)
        return { data: null, error: options.recordError }
      return { data: null, error: null }
    }),
    from: (table: string) => {
      let id = ''
      const chain = {
        select: () => chain,
        eq: (_: string, value: string) => {
          id = value
          // Sender domains are read as a list.
          if (table === 'competitor_sender_domains')
            return Promise.resolve({
              data: (brands[value]?.senders ?? []).map((domain) => ({
                domain
              })),
              error: null
            })
          return chain
        },
        maybeSingle: async () => {
          const m = messages[id]
          if (m?.broken === 'log') return { data: null, error: fault }
          return {
            data: m?.logged ? { outcome: m.logged } : null,
            error: null
          }
        },
        single: async () => {
          if (table === 'competitor_captures') {
            const m = Object.values(messages).find((x) => x.capture_id === id)
            if (m?.broken === 'brand') return { data: null, error: fault }
            return brands[id]
              ? { data: { domain: brands[id]!.domain }, error: null }
              : { data: null, error: { code: 'PGRST116' } }
          }
          const m = messages[id]
          if (!m || m.broken === 'message') return { data: null, error: fault }
          return {
            data: {
              id,
              confirm_url: m.confirm_url,
              capture_id: m.capture_id,
              synthetic: m.synthetic ?? false
            },
            error: null
          }
        }
      }
      return chain
    }
  }
}
type Db = Parameters<typeof confirmSubscriptions>[0]

/** A clicker that answers `ok`; it remembers the host rule it was given. */
function clicker(ok = true, endsAt?: string) {
  const rules: ((host: string) => boolean)[] = []
  const fetch = vi.fn(async (url: string) =>
    ok
      ? { ok: true as const, bytes: new Uint8Array([1]), url: endsAt ?? url }
      : { ok: false as const, failure: 'broken' as const }
  )
  const make: LinkClicker = (allowHost) => {
    rules.push(allowHost)
    return { fetch } as ImageFetcher
  }
  return { make, fetch, rules }
}
const later = () => Date.now() + 60_000
const recorded = (db: ReturnType<typeof database>) =>
  db.calls
    .filter((c) => c.name === 'record_confirmation_click')
    .map((c) => c.args)
const sweep = (
  db: ReturnType<typeof database>,
  real: LinkClicker,
  sample: ImageFetcher = sampleLinkClicker
) => confirmSubscriptions(db as unknown as Db, { real, sample }, later())

describe('confirmSubscriptions', () => {
  it("opens a known brand's confirm link once, begun before it is opened, and logs where it ended", async () => {
    const real = clicker(true, 'https://manage.kmail-lists.com/subscribed')
    const db = database({
      m1: {
        confirm_url: 'https://manage.kmail-lists.com/subscribe?a=1',
        capture_id: 'northwind'
      }
    })
    expect(await sweep(db, real.make)).toEqual({
      clicked: 1,
      refused: 0,
      failed: 0
    })
    expect(real.fetch).toHaveBeenCalledOnce()
    const names = db.calls.map((c) => c.name)
    expect(names.indexOf('begin_confirmation_click')).toBeLessThan(
      names.indexOf('record_confirmation_click')
    )
    expect(recorded(db)).toEqual([
      {
        job: 'job-m1',
        lease: 'lease',
        host: 'manage.kmail-lists.com',
        outcome: 'clicked',
        final_host: 'manage.kmail-lists.com'
      }
    ])
    expect(names).toContain('finish_platform_job')
  })

  it('lets every redirect reach only the brand, its senders and email services', async () => {
    const real = clicker()
    const db = database({
      m1: {
        confirm_url: 'https://ctrk.klclick.com/l/abc',
        capture_id: 'northwind'
      }
    })
    await sweep(db, real.make)
    const allow = real.rules[0]!
    for (const host of [
      'northwind.com',
      'shop.northwind.com',
      'x.mailer.northwind-news.com',
      'manage.kmail-lists.com'
    ])
      expect(allow(host), host).toBe(true)
    for (const host of ['evil.test', 'attacker.ck.page', 'x.mailchi.mp'])
      expect(allow(host), host).toBe(false)
  })

  it('records a link whose redirect leaves the trusted hosts as refused', async () => {
    const real = clicker()
    real.fetch.mockResolvedValueOnce({ ok: false, failure: 'blocked' } as never)
    const db = database({
      m1: {
        confirm_url: 'https://ctrk.klclick.com/l/abc',
        capture_id: 'northwind'
      }
    })
    expect(await sweep(db, real.make)).toMatchObject({ refused: 1 })
    expect(recorded(db)[0]).toMatchObject({
      host: 'ctrk.klclick.com',
      outcome: 'refused'
    })
  })

  it('never opens a link to anywhere else, and leaves it to a person', async () => {
    const real = clicker()
    const db = database({
      evil: {
        confirm_url: 'https://northwind.com.evil.test/confirm',
        capture_id: 'northwind'
      },
      page: {
        confirm_url: 'https://attacker.ck.page/confirm',
        capture_id: 'northwind'
      },
      none: { confirm_url: null, capture_id: 'northwind' },
      // An email no brand claims (the database keeps one only for a
      // brand; this is the worker's own guard).
      unknown: {
        confirm_url: 'https://manage.kmail-lists.com/s',
        capture_id: null
      }
    })
    expect(await sweep(db, real.make)).toEqual({
      clicked: 0,
      refused: 4,
      failed: 0
    })
    expect(real.fetch).not.toHaveBeenCalled()
    expect(db.calls.map((c) => c.name)).not.toContain(
      'begin_confirmation_click'
    )
    expect(recorded(db).map((r) => [r.host, r.outcome])).toEqual([
      ['northwind.com.evil.test', 'refused'],
      ['attacker.ck.page', 'refused'],
      ['unknown', 'refused'],
      ['manage.kmail-lists.com', 'refused']
    ])
  })

  it('logs a link that did not answer as failed (a person checks it)', async () => {
    const db = database({
      m1: {
        confirm_url: 'https://northwind.com/confirm',
        capture_id: 'northwind'
      }
    })
    expect(await sweep(db, clicker(false).make)).toEqual({
      clicked: 0,
      refused: 0,
      failed: 1
    })
    expect(recorded(db)[0]).toMatchObject({ outcome: 'failed' })
    expect(recorded(db)[0]!.final_host).toBeUndefined()
  })

  it('uses the sample clicker for sample brands, never the network', async () => {
    const real = clicker()
    const sample = { fetch: vi.fn(sampleLinkClicker.fetch) }
    const db = database({
      s1: {
        confirm_url: 'https://northwind.com/confirm',
        capture_id: 'northwind',
        synthetic: true
      }
    })
    await sweep(db, real.make, sample)
    expect(sample.fetch).toHaveBeenCalledOnce()
    expect(real.fetch).not.toHaveBeenCalled()
  })

  it('does not open a link again once its click is logged', async () => {
    const real = clicker()
    const db = database({
      m1: {
        confirm_url: 'https://northwind.com/confirm',
        capture_id: 'northwind',
        logged: 'clicked'
      }
    })
    await sweep(db, real.make)
    expect(real.fetch).not.toHaveBeenCalled()
    expect(recorded(db)).toEqual([])
    expect(
      db.calls.find((c) => c.name === 'finish_platform_job')!.args
    ).toMatchObject({ outcome: { outcome: 'clicked', already: true } })
  })

  it('after a crash mid-click, leaves the link to a person instead of opening it again', async () => {
    const real = clicker()
    const db = database({
      m1: {
        confirm_url: 'https://northwind.com/confirm',
        capture_id: 'northwind',
        logged: 'attempted'
      }
    })
    expect(await sweep(db, real.make)).toMatchObject({ failed: 1 })
    expect(real.fetch).not.toHaveBeenCalled()
    expect(recorded(db)).toEqual([
      expect.objectContaining({ host: 'northwind.com', outcome: 'failed' })
    ])
  })

  it('opens nothing when another worker began the same click', async () => {
    const real = clicker()
    const db = database(
      {
        m1: {
          confirm_url: 'https://northwind.com/confirm',
          capture_id: 'northwind'
        }
      },
      { begun: false }
    )
    await sweep(db, real.make)
    expect(real.fetch).not.toHaveBeenCalled()
    expect(recorded(db)).toEqual([])
  })

  it('retries the job when a read fails, instead of logging a refusal', async () => {
    for (const broken of ['log', 'message', 'brand'] as const) {
      const real = clicker()
      const db = database({
        m1: {
          confirm_url: 'https://northwind.com/confirm',
          capture_id: 'northwind',
          broken
        }
      })
      expect(await sweep(db, real.make), broken).toEqual({
        clicked: 0,
        refused: 0,
        failed: 0
      })
      expect(real.fetch).not.toHaveBeenCalled()
      expect(recorded(db)).toEqual([])
      expect(
        db.calls.find((c) => c.name === 'fail_platform_job')!.args
      ).toMatchObject({ failure: 'internal' })
    }
  })

  it('fails the job with a safe code when the click cannot be logged', async () => {
    const db = database(
      {
        m1: {
          confirm_url: 'https://northwind.com/confirm',
          capture_id: 'northwind'
        }
      },
      { recordError: { code: 'PT409', message: 'Stale platform job lease' } }
    )
    expect(await sweep(db, clicker().make)).toEqual({
      clicked: 0,
      refused: 0,
      failed: 0
    })
    expect(
      db.calls.find((c) => c.name === 'fail_platform_job')!.args
    ).toMatchObject({ failure: 'internal', error_code: 'confirm_conflict' })
  })

  it('takes no job once its time is up', async () => {
    const db = database({ m1: { confirm_url: null, capture_id: null } })
    expect(
      await confirmSubscriptions(
        db as unknown as Db,
        { real: clicker().make, sample: sampleLinkClicker },
        Date.now() - 1
      )
    ).toEqual({ clicked: 0, refused: 0, failed: 0 })
    expect(db.calls).toEqual([])
  })
})
