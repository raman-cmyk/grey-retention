import { describe, it, expect } from 'vitest'
import { unpackAssetZip, inspectAsset, safeArchivePath } from './archive'
import {
  fixtureGraphic,
  FixtureCatalogMatcher,
  FixtureBrandKitExtractor,
  FixtureDrive
} from './fixture-adapters'
import { assetZip } from '../../tests/helpers/asset-zip'
describe('bounded original asset intake', () => {
  it('accepts stored/deflated PNGs and returns individual unsupported-file failures', () => {
    const bytes = fixtureGraphic(1),
      result = unpackAssetZip(
        assetZip([
          { name: 'kit/logo.png', bytes },
          { name: 'product.png', bytes, deflate: true },
          { name: 'script.svg', bytes: Buffer.from('<svg onload="alert(1)"/>') }
        ])
      )
    expect(result.files).toHaveLength(2)
    expect(result.failures).toHaveLength(1)
    expect(inspectAsset('graphic.png', bytes).mediaType).toBe('image/png')
  })
  it('rejects traversal, symlinks, duplicate names, bad checksums and declared expansion bombs', () => {
    for (const name of [
      '../a.png',
      '/a.png',
      'a\\b.png',
      'a/../b.png',
      'a:/x.png'
    ])
      expect(() => safeArchivePath(name)).toThrow()
    const bytes = fixtureGraphic(2),
      bad = unpackAssetZip(
        assetZip([
          { name: '../p.png', bytes },
          { name: 'link.png', bytes, mode: 0xa000 },
          { name: 'good.png', bytes, crc: 0 },
          { name: 'twice.png', bytes },
          { name: 'twice.png', bytes }
        ])
      )
    expect(bad.files).toHaveLength(1)
    expect(bad.failures).toHaveLength(4)
    expect(() =>
      unpackAssetZip(
        assetZip([
          { name: 'bomb.png', bytes, length: 50 * 1024 * 1024, deflate: true }
        ])
      )
    ).toThrow(/expanded/)
    expect(() => unpackAssetZip(Buffer.alloc(22))).toThrow()
    const corrupt = Buffer.from(bytes)
    corrupt[40] = corrupt[40]! ^ 1
    expect(() => inspectAsset('corrupt.png', corrupt)).toThrow()
  })
  it('keeps ambiguous product matches unresolved and refuses another tenant', async () => {
    const matcher = new FixtureCatalogMatcher(
      [{ id: 'a', tenantId: 'one', filename: 'product-sku1-sku2.png' }],
      [
        { id: '1', productId: 'p1', sku: 'sku1' },
        { id: '2', productId: 'p2', sku: 'sku2' }
      ]
    )
    expect((await matcher.match('a', 'one')).productId).toBeNull()
    await expect(matcher.match('a', 'two')).rejects.toThrow()
  })
  it('extracts only supplied kit tokens and keeps Drive read-only and fictional', async () => {
    expect(
      await new FixtureBrandKitExtractor().extract('Color #123abc; font: Inter')
    ).toEqual({ synthetic: true, colors: ['#123abc'], fonts: ['Inter'] })
    expect(
      (await new FixtureDrive().list('fixture:assets', null)).files
    ).toHaveLength(20)
    await expect(
      new FixtureDrive().list('real-folder-id', null)
    ).rejects.toThrow()
  })
})
