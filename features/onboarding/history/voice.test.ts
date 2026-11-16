// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { klaviyoClient } from '@/lib/providers/klaviyo/client'
import type { CampaignMessage } from '@/lib/providers/klaviyo/history'
import { recordedHistoryTransport } from '@/lib/providers/klaviyo/recorded-history'
import { readOwnerVoice, voiceCandidates } from './voice'

const message = (over: Partial<CampaignMessage>): CampaignMessage => ({
  id: 'MsgA08',
  campaignId: 'CmpA08',
  campaignName: null,
  archived: false,
  name: null,
  status: 'sent',
  sendAt: '2026-10-11T10:00:00.000Z',
  strategy: 'static',
  channel: 'email',
  subject: 'A note from our founder',
  preview: null,
  contentKnown: true,
  abTest: false,
  templateId: 'TplMsgA08',
  ...over
})

describe('the owner’s voice from the emails they sent (PIC-23 part 2b)', () => {
  it('reads only sent emails with a template, never GROS’s own, the newest first', () => {
    const { candidates, ours } = voiceCandidates(
      [
        message({ id: 'Old', sendAt: '2026-01-01T10:00:00Z' }),
        message({ id: 'New', sendAt: '2026-11-01T10:00:00Z' }),
        message({ id: 'Sms', channel: 'sms' }),
        message({ id: 'NoTemplate', templateId: null }),
        message({ id: 'Planned', status: 'scheduled' }),
        message({ id: 'Ours', campaignId: 'CmpGROS' }),
        message({ id: 'Unknown channel', channel: null })
      ],
      new Set(['CmpGROS'])
    )
    expect(candidates.map((m) => m.id)).toEqual([
      'New',
      'Unknown channel',
      'Old'
    ])
    expect(ours).toBe(1)
    expect(
      voiceCandidates(
        [message({ id: 'NoTemplate', templateId: null })],
        new Set()
      ).unknown
    ).toBe(1)
    const many = Array.from({ length: 60 }, (_, i) => message({ id: `M${i}` }))
    expect(voiceCandidates(many, new Set()).candidates).toHaveLength(40)
  })

  it('replaces the samples only after a whole read; a read cut short or blind keeps them', async () => {
    const client = klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
      transport: recordedHistoryTransport({
        now: new Date('2026-11-11T12:00:00Z')
      }),
      maxWaits: 0
    })
    const base = {
      client,
      more: () => true,
      sent: [message({})],
      sentComplete: true,
      ours: new Set<string>(),
      own: ['Cedar Goods']
    }
    const stopped = await readOwnerVoice({ ...base, more: () => false })
    expect(stopped).toMatchObject({
      found: [],
      authoritative: false,
      read: 0,
      stopped: 'time'
    })
    const found = await readOwnerVoice(base)
    expect(found).toMatchObject({ authoritative: true, read: 1, stopped: null })
    expect(found.found.map((s) => s.messageId)).toEqual(['MsgA08'])
    expect(found.found[0]?.sentAt).toBe('2026-10-11T10:00:00.000Z')
    // Nothing sent: all there is, so the samples go.
    expect(await readOwnerVoice({ ...base, sent: [] })).toMatchObject({
      found: [],
      authoritative: true,
      stopped: null
    })
    // A sent email whose template is unknown, or a list not read whole:
    // never all there is.
    expect(
      await readOwnerVoice({
        ...base,
        sent: [message({ id: 'Unread', templateId: null, contentKnown: false })]
      })
    ).toMatchObject({
      found: [],
      authoritative: false,
      stopped: 'content_unknown'
    })
    expect(
      await readOwnerVoice({ ...base, sentComplete: false })
    ).toMatchObject({ authoritative: false, stopped: 'content_unknown' })
  })
})
