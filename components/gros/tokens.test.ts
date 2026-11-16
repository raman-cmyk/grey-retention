// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../..')
const brand = readFileSync(join(root, 'docs/design/BRAND.md'), 'utf8')
const css = readFileSync(join(root, 'app/styles/gros.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

/** The declarations of one rule, by its exact selector. */
function rule(selector: string) {
  const at = css.indexOf(`${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  return new Map(
    [...body.matchAll(/([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim()
    ])
  )
}

describe('GROS tokens (UI-DS)', () => {
  it('has every BRAND.md token with its exact value', () => {
    const tokens = [
      ...brand.matchAll(/^\| `(--[a-z0-9-]+)`\s*\| `?([^|`]+?)`?\s*\|/gm)
    ].map((m) => [m[1]!, m[2]!.toLowerCase()] as const)
    expect(tokens.length).toBeGreaterThanOrEqual(35)
    const declared = rule('.gros')
    for (const [name, value] of tokens)
      expect(declared.get(name)?.toLowerCase(), name).toBe(value)
  })

  it('has every BRAND.md type style', () => {
    const styles = [
      ...brand.matchAll(
        /^\| `([a-z-]+)`\s*\| (\d+px)\s*\| ([\d.]+)\s*\| (\d+)\s*\| ([-\d.em]+)\s*\|/gm
      )
    ]
    expect(styles).toHaveLength(11)
    for (const [, name, size, height, weight, spacing] of styles) {
      const declared = rule(`.gros .type-${name}`)
      expect(
        [
          declared.get('font-size'),
          declared.get('line-height'),
          declared.get('font-weight'),
          declared.get('letter-spacing')
        ],
        name
      ).toEqual([size, height, weight, spacing])
    }
  })

  it('scopes every rule to a GROS screen', () => {
    const selectors = [
      ...css.matchAll(/(?:^|[{}])\s*([^{}@;\s][^{};]*?)\s*\{/g)
    ]
      .map((m) => m[1]!.trim())
      .flatMap((s) => s.split(',').map((p) => p.trim()))
    expect(selectors.length).toBeGreaterThan(20)
    for (const s of selectors) expect(s, s).toMatch(/^\.gros(\s|$)/)
  })

  it('keeps raw colours out of the components', () => {
    const dir = join(root, 'components/gros')
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx')))
      expect(readFileSync(join(dir, file), 'utf8'), file).not.toMatch(
        /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(|\b(?:bg|text|border|fill|stroke|ring|outline|from|to)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b/i
      )
  })
})
