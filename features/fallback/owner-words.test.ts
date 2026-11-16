// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ownerLine, teamNames, unnamed } from './owner-words'

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
    expect(line('email-inspector', 'inspector_agent_failed').who).toBe(
      'The email check'
    )
    // An agent not named here, or a key from the object's prototype: never
    // a name that could mean a person (the Team page, human designers).
    expect(unnamed).toBe('The app')
    expect(line('someone-new', 'x_check_failed').who).toBe(unnamed)
    expect(line('toString', 'x_check_failed').who).toBe(unnamed)
    for (const name of Object.values(teamNames))
      expect(name).not.toMatch(/\b(designer|team|person|staff)\b/i)
  })

  it('says the AI’s own failures plainly by their reason code, and keeps every other reason', () => {
    for (const code of [
      'critic_agent_failed',
      'email_critic_agent_failed',
      'content_agent_failed',
      'agent_failed'
    ])
      expect(line('design-critic', code).what).toBe(
        'The AI could not answer this time (it may have been unavailable, or the AI allowance is used up).'
      )
    for (const code of [
      'storyboard_answer_invalid',
      'brief_answer_invalid',
      'answer_invalid'
    ])
      expect(line('art-director', code).what).toBe(
        'The AI kept giving answers we could not use.'
      )
    // Its answers kept failing our checks: only the AI's own codes.
    for (const code of [
      'check_failed',
      'content_check_failed',
      'brief_check_failed',
      'planner_check_failed',
      'storyboard_check_failed',
      'inspector_check_failed'
    ])
      expect(line('content-locker', code, 'The Content locker …').what).toBe(
        'The AI’s answers kept failing our checks.'
      )
    // A check of rules keeps its own words.
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

  it('has owner words for every agent the code shows writing to the log (a backstop, not a proof)', () => {
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
      // A helper that takes the agent first, as the plan's `log` (an agent
      // key has a hyphen; a reason code, passed first elsewhere, has none).
      for (const m of text.matchAll(
        /\blog\(\s*'([a-z][a-z0-9]*-[a-z0-9-]+)',/g
      ))
        agents.add(m[1]!)
    }
    expect(agents.size).toBeGreaterThan(15)
    expect(agents).toContain('calendar-rules')
    const missing = [...agents].filter((a) => !Object.hasOwn(teamNames, a))
    expect(missing).toEqual([])
  })
})
