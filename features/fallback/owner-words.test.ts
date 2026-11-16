// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ownerLine, teamNames } from './owner-words'

/** REL-084b: the fallback log in the owner's words. */
const line = (agent: string, reasonCode: string, reason = 'Fixed words.') =>
  ownerLine({ agent, reasonCode, reason, fallback: 'Did the safe thing.' })

/** Every TypeScript file under `dir`, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name)
    if (statSync(file).isDirectory()) return sources(file)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : []
  })
}

describe('the fallback log in the owner’s words (REL-084b)', () => {
  it('names who gave up in the owner’s words, never an agent key', () => {
    expect(line('content-locker', 'content_replaced').who).toBe(
      'Choosing the email’s content'
    )
    expect(line('design-critic', 'critic_agent_failed').who).toBe(
      'The design studio'
    )
    expect(line('email-checks', 'hard_check_offer').who).toBe(
      'The email checks'
    )
    // An agent not named here, or a key from the object's prototype.
    expect(line('someone-new', 'x_check_failed').who).toBe('The team')
    expect(line('toString', 'x_check_failed').who).toBe('The team')
  })

  it('says the AI’s own failures plainly by their reason code, and keeps every other reason', () => {
    for (const code of [
      'critic_agent_failed',
      'email_critic_agent_failed',
      'content_agent_failed',
      'agent_failed'
    ])
      expect(line('design-critic', code).what).toBe(
        'The AI could not answer: it was unavailable, or this month’s AI allowance is used up.'
      )
    for (const code of [
      'storyboard_answer_invalid',
      'brief_answer_invalid',
      'answer_invalid'
    ])
      expect(line('art-director', code).what).toBe(
        'The AI kept giving answers we could not use.'
      )
    expect(
      line('copy-check', 'copy_check_failed', 'It is not in the brand’s voice.')
    ).toEqual({
      who: 'The copy check',
      what: 'It is not in the brand’s voice.',
      instead: 'Did the safe thing.'
    })
    // A code that only looks alike is not one of the AI's failures.
    expect(line('copy-check', 'agent_failed_twice', 'Kept.').what).toBe('Kept.')
  })

  it('has owner words for every agent that writes to the log', () => {
    const root = path.resolve(__dirname, '..', '..')
    const agents = new Set<string>()
    for (const file of [
      ...sources(path.join(root, 'features')),
      ...sources(path.join(root, 'lib'))
    ]) {
      const text = readFileSync(file, 'utf8')
      // Literal agents on log lines, and every agent definition's name.
      for (const m of text.matchAll(/\bagent: '([a-z][a-z0-9_-]+)'/g))
        agents.add(m[1]!)
      for (const m of text.matchAll(
        /AgentDefinition<[\s\S]{0,200}?\bname: '([a-z][a-z0-9_-]+)'/g
      ))
        agents.add(m[1]!)
    }
    expect(agents.size).toBeGreaterThan(15)
    const missing = [...agents].filter((a) => !Object.hasOwn(teamNames, a))
    expect(missing).toEqual([])
  })
})
