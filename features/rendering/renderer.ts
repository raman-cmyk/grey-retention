import { z } from 'zod'
import type { RendererPort } from '@/features/workflow/domain/contracts'
export const sections = ['hero', 'copy', 'cta'] as const
export const stripSchema = z.object({
  section: z.enum(sections),
  path: z.string(),
  copyRevision: z.number().int().positive(),
  destination: z.url().optional()
})
export const escape = (text: string) =>
  text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
export function withUtm(url: string, campaignId: string) {
  const v = new URL(url)
  if (v.protocol !== 'https:') throw new Error('HTTPS required')
  v.searchParams.set('utm_source', 'grey_retention_fixture')
  v.searchParams.set('utm_medium', 'email')
  v.searchParams.set('utm_campaign', campaignId)
  return v.toString()
}
function lines(text: string, width = 52) {
  return text.split(/\n/).flatMap((p) => {
    const result: string[] = [],
      words = p.split(/\s+/)
    let row = ''
    for (const word of words) {
      if (row.length + word.length + 1 > width && row) {
        result.push(row)
        row = ''
      }
      row += `${row ? ' ' : ''}${word}`
    }
    return [...result, row]
  })
}
/** Original deterministic SVG sections; embedded assets and escaped text only, no external requests/scripts. */
export function renderStrip(input: {
  section: (typeof sections)[number]
  brand: string
  subject: string
  body: string
  cta: string
  color: string
  font: string
  asset?: { mediaType: string; base64: string }
  feedback?: string
  structure?: string[]
}) {
  const color = /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#222222',
    font = /^[a-zA-Z0-9 -]{1,60}$/.test(input.font) ? input.font : 'Arial'
  const text =
    input.section === 'hero'
      ? input.subject
      : input.section === 'copy'
        ? input.body
        : input.cta
  const rows = lines(text, input.section === 'hero' ? 28 : 52),
    hasAsset = input.section === 'hero' && input.asset
  const structuredSpacing = input.structure?.some((s) =>
    /product|detail/i.test(s)
  )
    ? 16
    : 0
  const top = (input.feedback ? 72 : 48) + structuredSpacing,
    height = Math.max(
      input.section === 'cta' ? 128 : 220,
      top + rows.length * 28 + (hasAsset ? 230 : 0) + 40
    )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${height}" viewBox="0 0 600 ${height}"><rect width="600" height="${height}" fill="${input.section === 'cta' ? color : '#f4f1e9'}"/><text x="40" y="28" font-size="12" font-family="${escape(font)}" fill="${input.section === 'cta' ? 'white' : color}">${escape(input.brand)} · SYNTHETIC FIXTURE</text>${input.feedback ? `<text x="40" y="50" font-family="Arial" font-size="12" fill="${color}">${escape(`Section revision: ${input.feedback}`.slice(0, 70))}</text>` : ''}${rows.map((line, i) => `<text x="40" y="${top + i * 28}" font-family="${escape(font)},sans-serif" font-size="${input.section === 'hero' ? 26 : 18}" fill="${input.section === 'cta' ? 'white' : color}">${escape(line)}</text>`).join('')}${hasAsset ? `<image x="40" y="${top + rows.length * 28 + 20}" width="520" height="190" preserveAspectRatio="xMidYMid meet" href="data:${input.asset!.mediaType};base64,${input.asset!.base64}"/>` : ''}</svg>`
  return { svg, width: 600, height }
}
export class FixtureStructureRenderer implements RendererPort {
  async render(input: Parameters<RendererPort['render']>[0]) {
    return {
      html: `<html><body><p style="white-space:pre-wrap">${escape(input.text)}</p></body></html>`,
      strips: input.assetPaths.map((path, i) => ({
        section: input.structure[i] ?? 'hero',
        artifactPath: path,
        copyRevision: input.copyRevision
      })),
      synthetic: true
    }
  }
}
export interface LinkValidator {
  validate(
    url: string,
    domain: string
  ): Promise<{ valid: boolean; source: 'fixture'; reason: string | null }>
}
export class FixtureLinkValidator implements LinkValidator {
  async validate(url: string, domain: string) {
    try {
      const parsed = new URL(url),
        valid =
          parsed.protocol === 'https:' &&
          parsed.hostname === domain &&
          !parsed.username &&
          !parsed.password
      return {
        valid,
        source: 'fixture' as const,
        reason: valid
          ? null
          : 'Destination must be an HTTPS URL on the approved brand domain.'
      }
    } catch {
      return {
        valid: false,
        source: 'fixture' as const,
        reason: 'Invalid URL.'
      }
    }
  }
}
