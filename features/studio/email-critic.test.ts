// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import {
  critiqueEmail,
  emailCriticAgent,
  emailCriticProblems,
  maxEmailPictureBytes,
  type EmailCritique,
  type EmailPicture,
  type EmailViews
} from './email-critic'

/** DST-006d part 1: the Design critic on the whole email. */
const view = (width: number, over: Partial<EmailPicture> = {}) => ({
  bytes: new Uint8Array([0xff, 0xd8, 0xff, width % 256]),
  contentType: 'image/jpeg' as const,
  width,
  height: 2100,
  cut: false,
  wide: false,
  ...over
})
const views: EmailViews = { desktop: view(600), phone: view(375) }
const nines: EmailCritique['scores'] = {
  hierarchy: 9,
  spacing: 8,
  contrast: 9,
  alignment: 9,
  product: 8,
  button: 9,
  phone: 8
}
const good: EmailCritique = { scores: nines, fixes: [] }
const email = {
  emailType: 'launch',
  angle: 'The new tray is here',
  brand: 'Grove & Co'
}
const ok = (content: unknown) => ({
  ok: true as const,
  content,
  provider: 'gemini' as const,
  model: 'test',
  costMicro: 0,
  inputTokens: 1,
  outputTokens: 1,
  settled: true
})
const ctx = (ai: AiCall) => {
  const fallbacks = memoryFallbackLog()
  return {
    fallbacks,
    ctx: {
      tenantId: '00000000-0000-4000-8000-000000000101',
      callerKey: 'email-build:b1',
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      ai,
      fallbacks
    }
  }
}
const base64 = (p: EmailPicture) => Buffer.from(p.bytes).toString('base64')

describe('the whole email’s verdict (DST-006d)', () => {
  it('passes an email that scores 8 or more everywhere, the button too', () => {
    expect(emailCriticProblems(good, views)).toEqual({
      pass: true,
      scores: nines,
      problems: []
    })
  })

  it('a low score fails, with the item and the critic’s fixes', () => {
    expect(
      emailCriticProblems(
        {
          scores: { ...nines, button: 6, phone: 7 },
          fixes: ['Make the button larger.', 'Make the button larger.']
        },
        views
      )
    ).toEqual({
      pass: false,
      scores: { ...nines, button: 6, phone: 7 },
      problems: [
        'The button (easy to see and tap, clear words) scored 6 of 10.',
        'Phone (readable at 375 px wide) scored 7 of 10.',
        'Make the button larger.'
      ]
    })
  })

  it('never passes something wider than a view, whatever the scores', () => {
    expect(
      emailCriticProblems(good, {
        ...views,
        phone: view(375, { wide: true })
      })
    ).toMatchObject({
      pass: false,
      problems: [
        'Something in the email is wider than 375 px (phone): it must fit the screen.'
      ]
    })
  })
})

describe('the Design critic on the whole email (DST-006d)', () => {
  it('is the same Design critic, on Flash, seeing desktop, then the phone, then dark', () => {
    expect(emailCriticAgent.name).toBe('design-critic')
    expect(emailCriticAgent.purpose).toBe('review')
    expect(emailCriticAgent.instructions).toMatch(/The button/)
    expect(emailCriticAgent.instructions).toMatch(/not instructions/)
    const dark = view(600, { cut: true, height: 6000 })
    const task = JSON.parse(
      emailCriticAgent.task({
        email,
        views: { ...views, dark },
        images: [],
        problems: []
      })
    )
    expect(task).toEqual({
      email: { type: 'launch', angle: 'The new tray is here' },
      brand: { name: 'Grove & Co' },
      pictures: [
        { view: 'the whole email at 600 px wide (desktop)', height: 2100 },
        { view: 'the whole email at 375 px wide (a phone)', height: 2100 },
        {
          view: 'the whole email at 600 px in dark mode',
          height: 6000,
          cut: true
        }
      ]
    })
  })

  it('gives its verdict, with every view sent in order', async () => {
    const ai = vi.fn<AiCall>(async () =>
      ok({ scores: { ...nines, button: 7 }, fixes: ['A larger button.'] })
    )
    const { ctx: c, fallbacks } = ctx(ai)
    const dark = view(600, { bytes: new Uint8Array([9, 9]) })
    expect(
      await critiqueEmail({ email, views: { ...views, dark } }, c)
    ).toMatchObject({
      pass: false,
      problems: [
        'The button (easy to see and tap, clear words) scored 7 of 10.',
        'A larger button.'
      ]
    })
    expect(ai.mock.calls[0][0].callerKey).toBe('design-critic:email-build:b1')
    expect(ai.mock.calls[0][0].request.images).toEqual([
      { mediaType: 'image/jpeg', base64: base64(views.desktop) },
      { mediaType: 'image/jpeg', base64: base64(views.phone) },
      { mediaType: 'image/jpeg', base64: base64(dark) }
    ])
    expect(fallbacks.entries()).toEqual([])
  })

  it('asks again after a wrong shape, with the problem sent back, and takes no time limit', async () => {
    const ai = vi
      .fn<AiCall>()
      .mockResolvedValueOnce(ok({ scores: nines }))
      .mockResolvedValueOnce(ok(good))
    const { ctx: c } = ctx(ai)
    // A caller's time limit is not the critic's.
    const withFits = { ...c, fits: () => false }
    expect(await critiqueEmail({ email, views }, withFits)).toMatchObject({
      pass: true
    })
    expect(
      JSON.parse(ai.mock.calls[1][0].request.user)
        .fix_these_problems_from_your_last_answer
    ).toEqual(['The answer did not match the required JSON shape.'])
  })

  it('refuses a view of the wrong width or a picture over 3 MiB', async () => {
    const ai = vi.fn<AiCall>(async () => ok(good))
    const { ctx: c } = ctx(ai)
    await expect(
      critiqueEmail({ email, views: { ...views, phone: view(600) } }, c)
    ).rejects.toThrow('not 375 px wide')
    await expect(
      critiqueEmail(
        {
          email,
          views: {
            ...views,
            desktop: view(600, {
              bytes: new Uint8Array(maxEmailPictureBytes + 1)
            })
          }
        },
        c
      )
    ).rejects.toThrow('too large')
    expect(ai).not.toHaveBeenCalled()
  })

  it('no verdict, logged in fixed words, when it answers in the wrong shape or not at all', async () => {
    const shape = ctx(vi.fn<AiCall>(async () => ok({ scores: nines })))
    expect(await critiqueEmail({ email, views }, shape.ctx)).toBeNull()
    expect(shape.fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'design-critic',
        reasonCode: 'email_critic_answer_invalid',
        reason: 'The Design critic kept answering in the wrong shape.',
        fallback: 'Drew the email with its coded blocks.',
        attempts: 3,
        detail: { section: 'email', runId: expect.any(String) },
        dedupeKey: 'design-critic:email-build-b1:email'
      })
    ])
    const down = ctx(
      vi.fn<AiCall>(async () => ({ ok: false, code: 'cap_reached' }))
    )
    expect(await critiqueEmail({ email, views }, down.ctx)).toBeNull()
    expect(down.fallbacks.entries()[0]).toMatchObject({
      reasonCode: 'email_critic_agent_failed',
      attempts: 1
    })
    expect(JSON.stringify(down.fallbacks.entries())).not.toContain('tray')
  })
})
