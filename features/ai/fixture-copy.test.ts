import { expect, it } from 'vitest'
import { generateFixtureCopy } from './fixture-copy'
it('produces labelled original grounded output without invented discounts or urgency', () => {
  const result = generateFixtureCopy({
    brandRevision: 3,
    brandName: 'Fictional Cedar',
    title: 'A quiet weekend',
    productTitle: 'Field overshirt',
    url: 'https://cedar-lane.example/products/overshirt'
  })
  expect(result.synthetic).toBe(true)
  expect(result.brandRevision).toBe(3)
  expect(result.subjects).toHaveLength(3)
  expect(result.body).toContain('Field overshirt')
  expect(result.url).toBe('https://cedar-lane.example/products/overshirt')
  expect(result.body).not.toMatch(/\d+%|ends tonight|last chance/i)
  expect(() =>
    generateFixtureCopy({
      brandRevision: 3,
      brandName: 'Fictional',
      title: 'A note',
      productTitle: null,
      url: 'javascript:alert(1)'
    })
  ).toThrow()
})
