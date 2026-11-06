// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  categoryLabel,
  matches,
  readyToSend,
  requestSchema,
  statusOf,
  type FeatureRequest
} from './rules'

const check = (values: Partial<Record<string, string>>) => {
  const parsed = requestSchema.safeParse({
    category: 'feature',
    subject: 'Duplicate button',
    details: 'Please.',
    ...values
  })
  return parsed.success ? parsed.data : parsed.error.issues[0]?.message
}

describe('feature request rules', () => {
  it('has the old app’s four types', () => {
    expect(Object.values(categoryLabel)).toEqual([
      'Feature Request',
      'Improve Existing',
      'Bug',
      'General Feedback'
    ])
  })

  it('shows Open, Planned and Done from the ticket state', () => {
    expect(statusOf('open')).toBe('open')
    expect(statusOf('in_progress')).toBe('planned')
    expect(statusOf('closed')).toBe('done')
    expect(statusOf('anything else')).toBe('open')
  })

  it('checks the form like the database', () => {
    expect(
      check({ subject: '  Duplicate button ', details: '\r\n Please.\r\n ' })
    ).toEqual({
      category: 'feature',
      subject: 'Duplicate button',
      details: 'Please.'
    })
    expect(check({ category: 'wish' })).toBe('Choose a type.')
    expect(check({ subject: 'X' })).toBe('Subject: at least 2 characters.')
    expect(check({ subject: 'Two\nlines' })).toBe(
      'Subject: use one line of text.'
    )
    expect(check({ subject: 'x'.repeat(201) })).toBe(
      'Subject: at most 200 characters.'
    )
    expect(check({ details: ' \n\t ' })).toBe('Details: tell us a little more.')
    expect(check({ details: 'x'.repeat(5001) })).toBe(
      'Details: at most 5000 characters.'
    )
    // Counted like the database: an emoji is one character.
    expect(check({ subject: '🎉'.repeat(200) })).toMatchObject({
      subject: '🎉'.repeat(200)
    })
  })

  it('enables Send only when both fields have text', () => {
    expect(readyToSend('', '')).toBe(false)
    expect(readyToSend('Idea', ' ')).toBe(false)
    expect(readyToSend(' ', 'Details')).toBe(false)
    expect(readyToSend('Idea', 'Details')).toBe(true)
  })

  it('searches subject, details and replies', () => {
    const request: FeatureRequest = {
      id: '1',
      subject: 'Duplicate campaign',
      category: 'feature',
      status: 'open',
      createdAt: '2026-11-06T10:00:00Z',
      by: 'You',
      mine: true,
      details: 'Reuse last week',
      replies: [
        {
          id: 'r',
          author: 'Grey Retention team',
          fromTeam: true,
          body: 'On our roadmap',
          createdAt: '2026-11-06T11:00:00Z'
        }
      ]
    }
    expect(matches(request, '')).toBe(true)
    expect(matches(request, 'DUPLICATE')).toBe(true)
    expect(matches(request, 'last week')).toBe(true)
    expect(matches(request, 'roadmap')).toBe(true)
    expect(matches(request, 'invoice')).toBe(false)
  })
})
