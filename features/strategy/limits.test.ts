import { describe, expect, it } from 'vitest'
import { thinkingBudget } from './retry'
import { brandPulseAgent } from './pulse'
import { competitorMapperAgent } from './competitors'
import {
  briefWriterAgent,
  calendarPlannerAgent,
  strategyCriticAgent
} from './plan'

// Gemini 2.5 counts thinking as output: each limit must leave room for the
// answer after the thinking budget, or a live reply is cut off (a refusal).
describe('strategy agent output limits', () => {
  it.each([
    brandPulseAgent,
    competitorMapperAgent,
    briefWriterAgent,
    calendarPlannerAgent,
    strategyCriticAgent
  ])('$name leaves room for its answer', (def) => {
    const thinking = thinkingBudget[def.reasoningEffort ?? 'none']
    expect(def.maxOutputTokens - thinking).toBeGreaterThanOrEqual(1000)
  })
})
