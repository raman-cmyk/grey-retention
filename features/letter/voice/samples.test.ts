import { describe, expect, it, vi } from 'vitest'
import {
  maxVoiceChars,
  maxVoiceSamples,
  pickVoiceSamples,
  readVoiceSamples,
  recordVoiceSamples,
  type VoiceSample
} from './samples'

vi.mock('server-only', () => ({}))

const words =
  'I started this shop in my garage with one sewing machine and a lot of stubbornness, and every shirt still gets checked by hand before it ships out to you.'
const s = (over: Partial<VoiceSample>): VoiceSample => ({
  messageId: 'MsgA08',
  text: words,
  weight: 3,
  words: 30,
  sentAt: '2026-10-01T10:00:00.000Z',
  ...over
})

describe('the owner’s words kept per workspace (PIC-23 part 2b)', () => {
  it('keeps the letters first, then the newest, each message once', () => {
    const picked = pickVoiceSamples([
      s({ messageId: 'Designed', weight: 1, sentAt: '2026-11-01T10:00:00Z' }),
      s({ messageId: 'OldLetter', sentAt: '2026-01-01T10:00:00Z' }),
      s({ messageId: 'NewLetter', sentAt: '2026-11-01T10:00:00Z' }),
      s({ messageId: 'Code', weight: 2, sentAt: null }),
      s({ messageId: 'NewLetter', text: `${words} Again.` })
    ])
    expect(picked.map((p) => p.messageId)).toEqual([
      'NewLetter',
      'OldLetter',
      'Code',
      'Designed'
    ])
  })

  it('keeps at most 20 and 60,000 characters, passing over one too long for a shorter one', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      s({ messageId: `Msg${i}` })
    )
    expect(pickVoiceSamples(many)).toHaveLength(maxVoiceSamples)
    const long = 'word '.repeat(1_599) + 'end.'
    const heavy = [
      ...Array.from({ length: 7 }, (_, i) =>
        s({ messageId: `Long${i}`, text: long, words: 1_600 })
      ),
      s({ messageId: 'Late', weight: 1, text: long, words: 1_600 }),
      s({ messageId: 'Short', weight: 1 })
    ]
    const picked = pickVoiceSamples(heavy)
    expect(picked.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(
      maxVoiceChars
    )
    expect(picked.map((p) => p.messageId)).toContain('Short')
    expect(picked.map((p) => p.messageId)).not.toContain('Late')
  })

  it('leaves out a sample the table would refuse', () => {
    const picked = pickVoiceSamples([
      s({ messageId: 'bad id' }),
      s({ messageId: 'Few', words: 24 }),
      s({ messageId: 'Empty', text: '' }),
      s({ messageId: 'Huge', text: 'a'.repeat(8_001) }),
      s({ messageId: 'Weight', weight: 4 as never }),
      s({ messageId: 'When', sentAt: 'yesterday' }),
      s({ messageId: 'Good' })
    ])
    expect(picked.map((p) => p.messageId)).toEqual(['Good'])
  })

  it('records under the job’s lease, and reads back only what fits', async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }))
    await expect(
      recordVoiceSamples({ rpc } as never, { id: 'job-1', lease: 'lease-1' }, [
        s({}),
        s({ messageId: 'bad id' })
      ])
    ).resolves.toBe(1)
    expect(rpc).toHaveBeenCalledWith('record_voice_samples', {
      job: 'job-1',
      lease: 'lease-1',
      samples: [s({})]
    })
    const failing = vi.fn(async () => ({
      data: null,
      error: { code: 'PT409', message: 'Lease unavailable' }
    }))
    await expect(
      recordVoiceSamples({ rpc: failing } as never, { id: 'j', lease: 'l' }, [])
    ).rejects.toMatchObject({ code: 'PT409' })

    const rows = [
      {
        message_id: 'MsgA08',
        text: words,
        weight: 3,
        words: 30,
        sent_at: '2026-10-01T10:00:00+00:00'
      },
      { message_id: 'MsgBad', text: '', weight: 9, words: 1, sent_at: null }
    ]
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(async () => ({ data: rows, error: null }))
    }
    const from = vi.fn(() => query)
    await expect(
      readVoiceSamples({ from } as never, 'tenant-1')
    ).resolves.toEqual([s({})])
    expect(from).toHaveBeenCalledWith('brand_voice_samples')
    expect(query.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1')
  })
})
