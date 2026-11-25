/**
 * DES-ENGINE-002: lets a browser job's plain Node script use the design
 * engine's TypeScript (`features/design-engine`), as the app and the
 * tests do, without a build step or a new dependency. Node 22 strips the
 * types itself; this hook only finds the files the way the app's
 * TypeScript settings do: `@/…` from the repository root, and an import
 * without an extension as its `.ts`, `.tsx`, `.mjs`, `.js` or `index.ts`.
 *
 *   node --import ./scripts/ts-register.mjs scripts/inbox-blueprints.mjs
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const endings = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts']

/** The file a path names, or null. */
export function findFile(path) {
  for (const end of endings) {
    const file = path + end
    if (existsSync(file) && statSync(file).isFile()) return file
  }
  return null
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const file = findFile(join(root, specifier.slice(2)))
    if (file) return next(pathToFileURL(file).href, context)
  }
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL?.startsWith('file:')
  ) {
    const file = findFile(fileURLToPath(new URL(specifier, context.parentURL)))
    if (file) return next(pathToFileURL(file).href, context)
  }
  return next(specifier, context)
}
