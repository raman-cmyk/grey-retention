import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isRetiredApprovalPath } from '@/features/approval/retired-paths'
import { isRetiredDesignerPath } from '@/features/designers/retired-paths'

/** Every page.tsx under app/, with the address it serves. */
function pages(dir = 'app'): { file: string; route: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return pages(path)
    if (!/^page\.(tsx|ts|jsx|js)$/.test(name)) return []
    const route =
      '/' +
      dir
        .split('/')
        .slice(1)
        .filter((part) => !/^\(.*\)$/.test(part))
        .join('/')
    return [{ file: path, route }]
  })
}

/**
 * A title of its own: `export const metadata = { title: '…' }` with a
 * non-empty text, or `generateMetadata`, on a line of its own (not in a
 * comment).
 */
const titled = (file: string) =>
  /^export const metadata\b[^=\n]*=\s*\{[^}]*?\btitle:\s*(?:'[^'\n]+'|"[^"\n]+"|`[^`\n]+`)|^export (?:async )?function generateMetadata\b/m.test(
    readFileSync(file, 'utf8')
  )

describe('page titles (BAS-008)', () => {
  it('gives every live page a title of its own', () => {
    const untitled = pages()
      .filter(
        ({ route }) =>
          !isRetiredDesignerPath(route) && !isRetiredApprovalPath(route)
      )
      // Pages that only send people on elsewhere show no title.
      .filter(({ route }) => !['/'].includes(route))
      .filter(({ file }) => {
        const layout = join(file, '..', 'layout.tsx')
        return !titled(file) && !(existsSync(layout) && titled(layout))
      })
      .map(({ file }) => file)
    // A new page needs `export const metadata: Metadata = { title: '…' }`.
    expect(untitled).toEqual([])
  })
})
