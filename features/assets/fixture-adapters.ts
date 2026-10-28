import { deflateSync } from 'node:zlib'
import { z } from 'zod'
import type {
  AssetClassifier,
  CatalogMatcher,
  DrivePort,
  CommercePort
} from '@/features/workflow/domain/contracts'
import { crc32 } from './archive'
export class FixtureAssetClassifier implements AssetClassifier {
  async classify(path: string) {
    const name = path.toLowerCase()
    const category = /logo|graphic/.test(name)
      ? 'logo'
      : /proof|ugc/.test(name)
        ? 'proof'
        : /lifestyle/.test(name)
          ? 'lifestyle'
          : /product/.test(name)
            ? 'product'
            : 'unusable'
    return { category, productId: null, synthetic: true } as const
  }
}
export class FixtureCatalogMatcher implements CatalogMatcher {
  constructor(
    private assets: { id: string; tenantId: string; filename: string }[],
    private variants: { id: string; productId: string; sku: string }[]
  ) {}
  async match(assetId: string, tenantId: string) {
    const asset = this.assets.find(
      (a) => a.id === assetId && a.tenantId === tenantId
    )
    if (!asset) throw new Error('Asset unavailable')
    const matches = this.variants.filter((v) =>
      asset.filename.toLowerCase().includes(v.sku.toLowerCase())
    )
    return {
      productId: matches.length === 1 ? matches[0]!.productId : null,
      variantId: matches.length === 1 ? matches[0]!.id : null,
      confidence: matches.length === 1 ? 0.8 : 0,
      synthetic: true
    }
  }
}
function chunk(type: string, bytes: Buffer) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    checksum = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])))
  return Buffer.concat([length, name, bytes, checksum])
}
/** An original solid-color PNG fixture, never a synthetic product photograph. */
export function fixtureGraphic(index: number, label?: string) {
  const head = Buffer.alloc(13)
  head.writeUInt32BE(32, 0)
  head.writeUInt32BE(32, 4)
  head[8] = 8
  head[9] = 6
  const scan = Buffer.alloc(32 * (1 + 32 * 4))
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const offset = y * 129 + 1 + x * 4
      scan[offset] = (index * 17 + x * 2) % 256
      scan[offset + 1] = (index * 29 + y * 2) % 256
      scan[offset + 2] = 180
      scan[offset + 3] = 255
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(scan)),
    ...(label ? [chunk('tEXt', Buffer.from(`Synthetic\0${label}`))] : []),
    chunk('IEND', Buffer.alloc(0))
  ])
}
export class FixtureDrive implements DrivePort {
  async list(folderId: string, cursor: string | null) {
    if (!/^fixture:[a-zA-Z0-9_-]{1,60}$/.test(folderId) || cursor)
      throw new Error('Only a single read-only fixture folder is supported')
    return {
      files: Array.from({ length: 20 }, (_, i) => ({
        id: `fixture-graphic-${i}`,
        name: `synthetic-logo-graphic-${i}.png`,
        mediaType: 'image/png',
        size: fixtureGraphic(i).length
      })),
      cursor: null
    }
  }
  bytes(id: string) {
    const result = /^fixture-graphic-(\d+)$/.exec(id)
    if (!result || Number(result[1]) > 19)
      throw new Error('Unknown fixture file')
    return fixtureGraphic(Number(result[1]))
  }
}
export class FixtureCommerce implements CommercePort {
  constructor(private domain: string) {}
  async products(cursor: string | null) {
    if (cursor || !/^[a-z0-9.-]+\.example$/.test(this.domain))
      throw new Error('Use a fictional .example domain for fixture commerce')
    return {
      products: [1, 2].map((n) => ({
        externalId: `fixture-product-${n}`,
        title: `Original demo product ${n} · Synthetic`,
        url: `https://${this.domain}/products/demo-${n}`,
        stock: 25,
        observedAt: new Date().toISOString()
      })),
      cursor: null,
      synthetic: true
    }
  }
}
export const brandKitOutput = z.object({
  synthetic: z.literal(true),
  colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(10),
  fonts: z.array(z.string().min(1).max(80)).max(10)
})
export interface BrandKitExtractor {
  extract(sourceText: string): Promise<z.infer<typeof brandKitOutput>>
}
export class FixtureBrandKitExtractor implements BrandKitExtractor {
  async extract(sourceText: string) {
    const colors = [
      ...new Set(sourceText.match(/#[0-9a-fA-F]{6}\b/g) ?? [])
    ].slice(0, 10)
    const fonts = [
      ...new Set(
        [...sourceText.matchAll(/font:\s*([A-Za-z0-9 -]{1,80})/g)].map((m) =>
          m[1]!.trim()
        )
      )
    ].slice(0, 10)
    return brandKitOutput.parse({ synthetic: true, colors, fonts })
  }
}
