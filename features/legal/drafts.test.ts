// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  legalDraftsOn,
  missingFields,
  operator,
  privacyDraft,
  termsDraft
} from './drafts'

/** POLICY-DRAFT: the drafts state only confirmed facts and stay hidden. */
const everyWord = (d: typeof privacyDraft) =>
  [
    d.title,
    d.draftNotice,
    ...d.sections.flatMap((s) => [s.heading, ...s.paragraphs])
  ].join('\n')
const checklist = readFileSync('docs/legal/CHECKLIST.md', 'utf8')

describe('the Privacy Policy and Terms drafts (POLICY-DRAFT)', () => {
  it('names no operator: the legal entity and address are a field for Raman', () => {
    expect(operator).toBe(
      '[NEEDS RAMAN: confirm legal entity and registered address]'
    )
    for (const draft of [privacyDraft, termsDraft]) {
      const words = everyWord(draft)
      expect(words).toContain(operator)
      // No company name or registered address of any kind.
      expect(words).not.toMatch(
        /\b(LLC|L\.L\.C\.|Inc\.?|Ltd\.?|GmbH|Corp\.?|Limited)\b/
      )
      expect(words).not.toMatch(/registered (office|agent) (is|at)/i)
      // No retention period, training promise or agreement is stated.
      expect(words).not.toMatch(/\b\d+ (days|months|years)\b/)
    }
  })

  it('lists every field still needed in the checklist, the entity first', () => {
    const first = checklist.match(/^1\. \*\*(.+?)\*\*/m)?.[1]
    expect(first).toBe('Confirm the legal entity and its registered address.')
    const fields = [
      ...missingFields(privacyDraft),
      ...missingFields(termsDraft)
    ]
    expect(fields.length).toBeGreaterThanOrEqual(13)
    // Each field's own words are on the checklist (its first two words,
    // punctuation aside).
    const plain = (t: string) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9’' ]+/g, ' ')
        .replace(/\s+/g, ' ')
    const list = plain(checklist)
    for (const f of new Set(fields)) {
      const start = plain(f.replace(/^confirm /, ''))
        .trim()
        .split(' ')
        .slice(0, 2)
        .join(' ')
      expect(list, f).toContain(start)
    }
  })

  it('says it is a draft at the top of each page', () => {
    for (const draft of [privacyDraft, termsDraft])
      expect(draft.draftNotice).toMatch(
        /^Draft for review\. This page is not in force and is not linked from sign-up\./
      )
  })

  it('shows only with the switch on', () => {
    const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv
    expect(legalDraftsOn(env({}))).toBe(false)
    expect(legalDraftsOn(env({ LEGAL_DRAFTS: 'yes' }))).toBe(false)
    expect(legalDraftsOn(env({ LEGAL_DRAFTS: 'on' }))).toBe(true)
  })

  it('is not linked from sign-up or anywhere else in the app', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
            ? [join(dir, e.name)]
            : []
      )
    const linking = ['app', 'components', 'features', 'lib']
      .flatMap(files)
      .filter((f) => !f.startsWith(join('features', 'legal')))
      .filter((f) =>
        /href=\{?["'`]\/(privacy|terms)["'`]|["'`]\/(privacy|terms)["'`]/.test(
          readFileSync(f, 'utf8')
        )
      )
    expect(linking).toEqual([])
    // Nor kept behind sign-in: the proxy does not guard them.
    expect(readFileSync('proxy.ts', 'utf8')).not.toMatch(/\/(privacy|terms)/)
  })
})

describe('the draft pages', () => {
  it('are not found with the switch off, and say draft with it on', async () => {
    const notFound = vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND')
    })
    vi.doMock('next/navigation', () => ({ notFound }))
    for (const path of [
      '@/app/(auth)/privacy/page',
      '@/app/(auth)/terms/page'
    ]) {
      vi.stubEnv('LEGAL_DRAFTS', '')
      const { default: Page, metadata } = await import(path)
      expect(() => Page(), path).toThrow('NEXT_NOT_FOUND')
      expect(metadata.robots).toEqual({ index: false, follow: false })
      vi.stubEnv('LEGAL_DRAFTS', 'on')
      expect(Page().props.draft.draftNotice).toMatch(/^Draft for review/)
    }
    vi.unstubAllEnvs()
  })
})
