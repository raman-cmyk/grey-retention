import { describe, expect, it } from 'vitest'
import {
  sampleComments,
  sampleReviewSource,
  sampleReviews,
  sampleSocialSource,
  socialSourceFor
} from './review-source'

const query = (domain: string) => ({ brandName: 'Cedar Lane', domain })

describe('the sample review and social sources', () => {
  it('serve a synthetic brand’s samples only, never a real brand’s', async () => {
    const reviews = await sampleReviewSource.reviews(
      query('cedar-lane.example')
    )
    expect(reviews.ok && reviews.reviews.length).toBe(5)
    expect(reviews.ok && reviews.platforms[0]?.name).toBe('Judge.me')
    expect(await sampleReviewSource.reviews(query('real-brand.com'))).toEqual({
      ok: false,
      code: 'not_set_up'
    })
    const comments = await sampleSocialSource.comments(
      query('cedar-lane.example')
    )
    expect(comments.ok && comments.comments.length).toBe(2)
    expect(await sampleSocialSource.comments(query('real-brand.com'))).toEqual({
      ok: false,
      code: 'not_set_up'
    })
  })

  it('have a quiet brand with nothing to say', () => {
    expect(sampleReviews('quiet-shop.example')).toMatchObject({
      ok: true,
      reviews: []
    })
    expect(sampleComments('quiet-shop.example')).toEqual({
      ok: true,
      comments: []
    })
  })

  it('read no real brand’s social profiles until the owner chooses how', async () => {
    expect(socialSourceFor('sample')).toBe(sampleSocialSource)
    const live = socialSourceFor('live')
    expect(live.live).toBe(true)
    expect(await live.comments(query('real-brand.com'))).toEqual({
      ok: false,
      code: 'not_set_up'
    })
  })
})
