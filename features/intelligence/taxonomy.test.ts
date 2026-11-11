// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { blockTypes } from '@/features/blocks/catalog'
import {
  emailLabelsSchema,
  jsonSchemaOf,
  labelLists,
  sectionTagsSchema,
  styles
} from './taxonomy'

const migrations = path.join(process.cwd(), 'supabase/migrations')
const sql = readdirSync(migrations)
  .filter((f) => f.endsWith('_competitor_tags.sql'))
  .map((f) => readFileSync(path.join(migrations, f), 'utf8'))
  .join('\n')

/** The values a column's check allows, as written in the migration. */
function checked(column: string) {
  const match =
    column === 'styles'
      ? /styles <@ array\[([^\]]+)\]/.exec(sql)
      : new RegExp(`${column} in \\(([^)]+)\\)`).exec(sql)
  return (match?.[1] ?? '').match(/'([a-z_]+)'/g)?.map((v) => v.slice(1, -1))
}

describe('the label lists', () => {
  it('are the same in the code and in the database checks', () => {
    expect(sql).not.toBe('')
    for (const [column, values] of Object.entries(labelLists))
      expect(checked(column), column).toEqual([...values])
  })

  it('use the 20 seed block types as the 20 families', () => {
    expect(blockTypes).toHaveLength(20)
    expect(
      sectionTagsSchema.safeParse({
        family: 'hero_image',
        layout: 'full_width_image',
        purpose: 'hook',
        styles: ['photo_led'],
        confidence: 0.8
      }).success
    ).toBe(true)
  })

  it('refuse anything outside the lists, more than three styles and confidence outside 0..1', () => {
    const tags = {
      family: 'hero_image',
      layout: 'grid',
      purpose: 'hook',
      styles: [],
      confidence: 0.8
    }
    for (const bad of [
      { family: 'countdown' },
      { layout: 'zigzag' },
      { purpose: 'sell' },
      { styles: ['minimal', 'bold', 'dark', 'luxury'] },
      { styles: ['neon'] },
      { confidence: 1.2 }
    ])
      expect(
        sectionTagsSchema.safeParse({ ...tags, ...bad }).success,
        JSON.stringify(bad)
      ).toBe(false)
    // Repeats are dropped before the limit is checked.
    expect(
      sectionTagsSchema.parse({
        ...tags,
        styles: ['bold', 'bold', 'bold', 'bold']
      }).styles
    ).toEqual(['bold'])
    expect(
      emailLabelsSchema.safeParse({
        industry: 'apparel',
        emailType: 'sale',
        offerType: 'percent_off',
        season: 'black_friday',
        angle: 'urgency',
        brandSize: 'huge',
        confidence: 0.8
      }).success
    ).toBe(false)
  })

  it('give the model a strict answer shape', () => {
    expect(
      jsonSchemaOf({
        layout: labelLists.layout,
        styles: 'styles',
        confidence: 'confidence'
      })
    ).toEqual({
      type: 'object',
      properties: {
        layout: { type: 'string', enum: [...labelLists.layout] },
        styles: {
          type: 'array',
          items: { type: 'string', enum: [...styles] },
          maxItems: 3
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 }
      },
      required: ['layout', 'styles', 'confidence'],
      additionalProperties: false
    })
  })
})
