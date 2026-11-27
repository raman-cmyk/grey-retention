// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PlanEmail } from '@/features/strategy/plan-screen'
import {
  buildProgress,
  couldNot,
  createAllWords,
  emailLabel,
  pickSlots,
  progressWords,
  queueAll,
  type QueueAnswer
} from './create-all'

const email = (
  slot: number,
  stage: PlanEmail['stage'],
  over: Partial<PlanEmail> = {}
): PlanEmail => ({
  slot,
  stage,
  date: '2026-11-20',
  day: `Fri ${20 + slot}`,
  title: `Offer: Candle ${slot}`,
  details: [],
  format: 'designed',
  angle: 'A candle.',
  why: 'It sells.',
  evidence: [],
  status:
    stage === 'not_started'
      ? { kind: 'planned' }
      : stage === 'working'
        ? { kind: 'working', word: 'Writing' }
        : stage === 'ready'
          ? { kind: 'sample_draft' }
          : { kind: 'needs_you', reason: 'Its design could not be drawn.' },
  action:
    stage === 'not_started'
      ? { kind: 'create', label: 'Create email' }
      : stage === 'failed'
        ? { kind: 'create', label: 'Try again' }
        : stage === 'too_late'
          ? null
          : { kind: 'open', buildId: `b${slot}` },
  next: false,
  ...over
})

describe('which emails "Create all" queues (PICK-102)', () => {
  it('queues only emails with no build yet, in the screen’s order', () => {
    const emails = [
      email(3, 'not_started'),
      email(0, 'working'),
      email(1, 'ready'),
      email(4, 'failed'),
      email(2, 'not_started'),
      email(5, 'too_late')
    ]
    expect(pickSlots(emails)).toEqual({
      create: [3, 2],
      made: [0, 1],
      failed: [4],
      passed: [5]
    })
  })

  it('never queues an email the viewer has no Create email on', () => {
    // Staff see the plan without the button: nothing is theirs to queue.
    const staff = [email(0, 'not_started', { action: null })]
    expect(pickSlots(staff).create).toEqual([])
  })
})

/**
 * A stand-in for `create_email_build`: one open build per planned email
 * (`email_builds_one_open`), so asking again returns the same build.
 */
function command(refuse: Record<number, QueueAnswer> = {}) {
  const open = new Map<number, string>()
  let made = 0
  const calls: number[] = []
  const create = async (slot: number): Promise<QueueAnswer> => {
    calls.push(slot)
    const refused = refuse[slot]
    if (refused) return refused
    if (!open.has(slot)) open.set(slot, `build-${++made}`)
    return { ok: true, build: open.get(slot)! }
  }
  return { create, open, calls, made: () => made }
}

describe('queueing every email (PICK-102)', () => {
  it('makes one build per planned email, whatever the clicks and tabs', async () => {
    const db = command()
    // Two tabs click at once, then the owner clicks again.
    const [a, b] = await Promise.all([
      queueAll([0, 1, 2], db.create),
      queueAll([0, 1, 2], db.create)
    ])
    const c = await queueAll([0, 1, 2], db.create)
    expect(db.made()).toBe(3)
    expect(a.queued).toEqual(b.queued)
    expect(c.queued).toEqual(a.queued)
    expect(a.queued.map((q) => q.build)).toEqual([
      'build-1',
      'build-2',
      'build-3'
    ])
  })

  it('goes on past one email’s refusal, and a call that throws', async () => {
    const db = command({
      1: { ok: false, reason: 'This email could not be made after 5 tries.' }
    })
    const result = await queueAll([0, 1, 2, 3], async (slot) => {
      if (slot === 2) throw new Error('network')
      return db.create(slot)
    })
    expect(result.queued.map((q) => q.slot)).toEqual([0, 3])
    expect(result.refused).toEqual([
      { slot: 1, reason: 'This email could not be made after 5 tries.' },
      { slot: 2, reason: couldNot }
    ])
    expect(result.stopped).toBeNull()
  })

  it('stops at a refusal of the whole plan, and starts nothing after it', async () => {
    const db = command({
      1: { ok: false, stop: 'This plan has been replaced.' }
    })
    const result = await queueAll([0, 1, 2], db.create)
    expect(db.calls).toEqual([0, 1])
    expect(result.queued.map((q) => q.slot)).toEqual([0])
    expect(result.stopped).toBe('This plan has been replaced.')
  })
})

describe('what the owner is told (PICK-102)', () => {
  const emails = [0, 1, 2, 3].map((s) => email(s, 'not_started'))
  const pick = pickSlots(emails)

  it('says how many it started and that nothing is sent', () => {
    expect(
      createAllWords(emails, pick, {
        queued: emails.map((e) => ({ slot: e.slot, build: `b${e.slot}` })),
        refused: [],
        stopped: null
      })
    ).toBe(
      'Creating 4 emails. Each lands in Klaviyo as a draft; nothing is sent or scheduled. You can leave this page.'
    )
  })

  it('names each email a limit stopped, once per reason', () => {
    const words = createAllWords(emails, pick, {
      queued: [{ slot: 0, build: 'b0' }],
      refused: [
        { slot: 1, reason: 'This email could not be made after 5 tries.' },
        { slot: 2, reason: 'This email could not be made after 5 tries.' },
        { slot: 3, reason: 'This email’s day has passed.' }
      ],
      stopped: null
    })
    expect(words).toContain('Creating 1 email.')
    expect(words).toContain(
      'Not started: Fri 21, “Offer: Candle 1”; Fri 22, “Offer: Candle 2”. This email could not be made after 5 tries.'
    )
    expect(words).toContain(
      'Not started: Fri 23, “Offer: Candle 3”. This email’s day has passed.'
    )
  })

  it('says when the AI allowance is used up, or the AI team takes turns', () => {
    const one = {
      queued: [{ slot: 0, build: 'b0' }],
      refused: [],
      stopped: null
    }
    expect(
      createAllWords(emails, pick, one, { agents: true, allowanceUsed: true })
    ).toContain(
      'Your AI allowance is used up, so these emails are made by code only'
    )
    expect(createAllWords(emails, pick, one, { agents: true })).toContain(
      'The AI team makes them one at a time'
    )
    expect(createAllWords(emails, pick, one)).not.toContain('AI')
  })

  it('leaves failed emails to their own Try again, and says so', () => {
    const mixed = [email(0, 'failed'), email(1, 'not_started')]
    expect(
      createAllWords(mixed, pickSlots(mixed), {
        queued: [{ slot: 1, build: 'b1' }],
        refused: [],
        stopped: null
      })
    ).toContain('1 email that failed before keeps its own Try again.')
  })

  it('says when there is nothing left to create', () => {
    const made = [email(0, 'working'), email(1, 'ready')]
    const none = { queued: [], refused: [], stopped: null }
    expect(createAllWords(made, pickSlots(made), none)).toBe(
      'Every email in this plan is already made or being made.'
    )
    expect(createAllWords([], pickSlots([]), none)).toBe(
      'There is no email left to create in this plan.'
    )
  })

  it('labels an email by its day and title', () => {
    expect(emailLabel(emails, 2)).toBe('Fri 22, “Offer: Candle 2”')
    expect(emailLabel(emails, 9)).toBe('One email')
  })
})

describe('the plan’s progress (PICK-102)', () => {
  it('counts each email once: ready, failed, working, not started, too late', () => {
    const emails = [
      ...[0, 1, 2, 3, 4, 5].map((s) => email(s, 'ready')),
      email(6, 'failed'),
      ...[7, 8, 9, 10, 11, 12, 13, 14].map((s) => email(s, 'working'))
    ]
    const p = buildProgress(emails)
    expect(p).toEqual({
      total: 15,
      ready: 6,
      working: 8,
      failed: 1,
      notStarted: 0,
      tooLate: 0
    })
    expect(progressWords(p)).toBe('6 of 15 ready · 1 failed · 8 working')
    expect(
      progressWords(
        buildProgress([
          email(0, 'not_started'),
          email(1, 'too_late'),
          email(2, 'working')
        ])
      )
    ).toBe('0 of 3 ready · 1 working · 1 not started · 1 too late to make')
  })
})
