import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser } from '@playwright/test'
import {
  checkBlock,
  cutBlocks,
  dedupe,
  blockWords,
  type BlockCandidate,
  type BlockFailure,
  type BlockKind,
  type BlockSkip
} from '../blocks'
import { desktopWindow, measureHtml, pictureOf } from '../browser'
import { blueprintFrom } from '../measure'
import { drawBlueprint } from '../render'
import { forStorage } from '../stored'
import type { GoldenEmail } from './report'

/**
 * DES-ENGINE-004 gate runner: the library built from the golden emails'
 * sections, the way the block job builds it from the inbox. Each email is
 * measured and stored as the blueprint job stores it (bare), cut into
 * blocks (`cutBlocks`), de-duplicated by structural fingerprint, and each
 * distinct block is checked once (`checkBlock`: drawn back on its own in
 * the locked browser, compared with its source section). It writes
 * `results.json`, `summary.md`, `index.html` and one picture per distinct
 * block (drawn as it is stored: words blanked, pictures as empty boxes).
 */

export type BlockRow = {
  fingerprint: string
  kind: BlockKind
  /** Where it was first seen (`email-id#section`). */
  first: string
  uses: number
  emails: string[]
  pass: boolean
  failure: BlockFailure | null
  problems: string[]
  picture?: string
}

export type BlockGate = {
  emails: number
  sections: number
  /** Sections that became block candidates (every section but glue, undrawable and empty ones). */
  candidates: number
  skipped: Record<BlockSkip, number>
  /** Distinct structural fingerprints: the library's block count. */
  blocks: number
  /** Candidates folded into a block that already had their structure. */
  merged: number
  passed: number
  failed: number
  byKind: { kind: BlockKind; blocks: number; passed: number; uses: number }[]
  /** The most used layouts (uses ≥ 2): the "used a lot" signal. */
  reused: number
  rows: BlockRow[]
  errors: string[]
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function runBlockGate(
  browser: Browser,
  emails: readonly GoldenEmail[],
  out: string | null
): Promise<BlockGate> {
  if (out) mkdirSync(out, { recursive: true })
  const all: (BlockCandidate & { email: string })[] = []
  const skipped: Record<BlockSkip, number> = {
    glue: 0,
    cannot_copy: 0,
    empty: 0
  }
  const errors: string[] = []
  let sections = 0
  for (const email of emails) {
    const opened = await measureHtml(browser, email.html, desktopWindow)
    if (!opened.ok) {
      errors.push(`${email.id}: ${opened.error}`)
      continue
    }
    const measured = blueprintFrom(opened.measurement)
    if (!measured.ok) {
      errors.push(`${email.id}: ${measured.error}`)
      continue
    }
    const stored = forStorage(measured.blueprint)
    sections += stored.sections.length
    const cut = cutBlocks(stored)
    for (const s of cut.skipped) skipped[s.why]++
    all.push(...cut.blocks.map((b) => ({ ...b, email: email.id })))
  }
  const library = dedupe(all)
  const rows: BlockRow[] = []
  for (const { block, uses } of library) {
    const check = block.unsafe
      ? ({ pass: false, failure: block.unsafe, problems: [] } as const)
      : await checkBlock(browser, block.check)
    const row: BlockRow = {
      fingerprint: block.fingerprint,
      kind: block.kind,
      first: `${block.email}#${block.ordinal}`,
      uses,
      emails: [
        ...new Set(
          all
            .filter((c) => c.fingerprint === block.fingerprint)
            .map((c) => c.email)
        )
      ],
      pass: check.pass,
      failure: check.pass ? null : check.failure,
      problems: check.pass ? [] : [...check.problems]
    }
    if (out) {
      try {
        const name = `block-${rows.length + 1}-${block.kind}.jpg`
        writeFileSync(
          join(out, name),
          await pictureOf(browser, drawBlueprint(block.blueprint))
        )
        row.picture = name
      } catch {
        // A picture that cannot be taken leaves the row without one.
      }
    }
    rows.push(row)
  }
  const kinds = [...new Set(rows.map((r) => r.kind))].sort()
  const gate: BlockGate = {
    emails: emails.length,
    sections,
    candidates: all.length,
    skipped,
    blocks: library.length,
    merged: all.length - library.length,
    passed: rows.filter((r) => r.pass).length,
    failed: rows.filter((r) => !r.pass).length,
    byKind: kinds.map((kind) => {
      const of = rows.filter((r) => r.kind === kind)
      return {
        kind,
        blocks: of.length,
        passed: of.filter((r) => r.pass).length,
        uses: of.reduce((n, r) => n + r.uses, 0)
      }
    }),
    reused: rows.filter((r) => r.uses >= 2).length,
    rows,
    errors
  }
  if (out) writeReport(out, gate)
  return gate
}

function writeReport(out: string, gate: BlockGate) {
  writeFileSync(join(out, 'results.json'), JSON.stringify(gate, null, 2))
  const lines = [
    `# Block library from the ${gate.emails} golden emails: ${gate.blocks} blocks, ${gate.passed} pass the quality check`,
    '',
    `${gate.sections} sections were read. ${gate.candidates} became block candidates (${gate.skipped.glue} were space or a line between sections, ${gate.skipped.cannot_copy} cannot be drawn, ${gate.skipped.empty} were empty). Near-identical sections share one structural fingerprint: ${gate.merged} candidates were folded into a block that already had their layout, so the library holds **${gate.blocks} distinct blocks** (one block per distinct structure: this is how GROS counts a block until the owner decides BLK-SCALE-001). ${gate.reused} layouts are used more than once.`,
    '',
    `Quality check: each distinct block is drawn back on its own and compared with its source section (likeness: same parts, columns within 2 px, heights within 5 %, sizes within 1 px, grey boxes 90 % alike, fits a phone). ${gate.passed} pass, ${gate.failed} do not (they stay out of Scratch).`,
    '',
    '| Kind | Blocks | Pass | Uses |',
    '| --- | --- | --- | --- |',
    ...gate.byKind.map(
      (k) => `| ${k.kind} | ${k.blocks} | ${k.passed} | ${k.uses} |`
    ),
    '',
    '| # | Kind | First seen | Uses | Result | Why |',
    '| --- | --- | --- | --- | --- | --- |',
    ...gate.rows.map(
      (r, i) =>
        `| ${i + 1} | ${r.kind} | ${r.first} | ${r.uses} | ${r.pass ? 'pass' : 'FAIL'} | ${
          r.failure
            ? `${blockWords[r.failure]}${r.problems.length ? `: ${r.problems.join(' ')}` : ''}`.replace(
                /\|/g,
                '/'
              )
            : '–'
        } |`
    ),
    ...(gate.errors.length ? ['', '## Errors', ...gate.errors] : [])
  ]
  writeFileSync(join(out, 'summary.md'), `${lines.join('\n')}\n`)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Block library</title></head><body style="font:14px Arial;margin:24px"><h1>${gate.blocks} blocks from ${gate.emails} emails (${gate.merged} near-identical sections folded in), ${gate.passed} pass</h1><p>Each block is drawn as it is stored: words blanked, pictures as empty boxes. In GROS a block is only ever drawn in the brand's own look.</p>${gate.rows
    .map(
      (r, i) =>
        `<div style="display:inline-block;vertical-align:top;margin:0 16px 24px 0;width:360px"><p style="margin:0 0 4px"><b>${i + 1}. ${escape(r.kind)}</b> · used ${r.uses}× · ${r.pass ? 'pass' : `FAIL: ${escape(r.failure ? blockWords[r.failure] : '')}`}</p>${r.picture ? `<img src="${r.picture}" style="width:360px;border:1px solid #ddd">` : ''}</div>`
    )
    .join('')}</body></html>`
  writeFileSync(join(out, 'index.html'), html)
}
