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
    const many = Array.from({ length: 60 }, (_, i) => message({ id: `M${i}` }))
    expect(voiceCandidates(many, new Set()).candidates).toHaveLength(40)
  })

  it('keeps the earlier samples when the read stops before it finds any', async () => {
    const client = klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
      transport: recordedHistoryTransport({
        now: new Date('2026-11-11T12:00:00Z')
      }),
      maxWaits: 0
    })
    const stopped = await readOwnerVoice({
      client,
      more: () => false,
      sent: [message({})],
      ours: new Set(),
      own: ['Cedar Goods']
    })
    expect(stopped).toMatchObject({ samples: null, read: 0, stopped: 'time' })
    const found = await readOwnerVoice({
      client,
      more: () => true,
      sent: [message({})],
      ours: new Set(),
      own: ['Cedar Goods']
    })
    expect(found.samples?.map((s) => s.messageId)).toEqual(['MsgA08'])
    expect(found.samples?.[0]?.sentAt).toBe('2026-10-11T10:00:00.000Z')
    const none = await readOwnerVoice({
      client,
      more: () => true,
      sent: [],
      ours: new Set(),
      own: []
    })
    expect(none).toMatchObject({ samples: [], read: 0, stopped: null })
  })
})
