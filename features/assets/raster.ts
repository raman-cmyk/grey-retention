import { inflateSync } from 'node:zlib'
import { crc32 } from '@/lib/binary'
function dimensions(width: number, height: number) {
  if (width < 1 || height < 1 || width * height > 16_000_000)
    throw new Error('Raster dimensions exceed 16 million pixels')
}
/** Bounded container/CRC/PNG stream validation. This is not a vision or aesthetic quality evaluation. */
export function validateRaster(bytes: Uint8Array, mediaType: string) {
  const b = Buffer.from(bytes)
  if (mediaType === 'image/png') {
    let cursor = 8,
      seenHeader = false,
      seenEnd = false,
      width = 0,
      height = 0,
      depth = 0,
      color = 0,
      interlace = 0
    const compressed: Buffer[] = []
    while (cursor < b.length) {
      if (cursor + 12 > b.length) throw new Error('Truncated PNG chunk')
      const size = b.readUInt32BE(cursor),
        type = b.toString('ascii', cursor + 4, cursor + 8),
        end = cursor + 12 + size
      if (
        end > b.length ||
        crc32(b.subarray(cursor + 4, cursor + 8 + size)) !==
          b.readUInt32BE(cursor + 8 + size)
      )
        throw new Error('PNG checksum mismatch')
      if (!seenHeader && type !== 'IHDR') throw new Error('PNG header missing')
      if (type === 'IHDR') {
        if (seenHeader || size !== 13) throw new Error('Invalid PNG header')
        seenHeader = true
        width = b.readUInt32BE(cursor + 8)
        height = b.readUInt32BE(cursor + 12)
        depth = b[cursor + 16]!
        color = b[cursor + 17]!
        interlace = b[cursor + 20]!
        dimensions(width, height)
        if (
          ![1, 2, 4, 8, 16].includes(depth) ||
          ![0, 2, 3, 4, 6].includes(color) ||
          b[cursor + 18] !== 0 ||
          b[cursor + 19] !== 0 ||
          interlace > 1 ||
          (color !== 0 && color !== 3 && depth < 8) ||
          (color === 3 && depth === 16)
        )
          throw new Error('Unsupported PNG layout')
      }
      if (type === 'IDAT')
        compressed.push(b.subarray(cursor + 8, cursor + 8 + size))
      if (type === 'IEND') {
        if (size !== 0 || end !== b.length) throw new Error('Invalid PNG end')
        seenEnd = true
      }
      cursor = end
    }
    if (!seenHeader || !seenEnd || !compressed.length)
      throw new Error('Incomplete PNG image')
    const data = inflateSync(Buffer.concat(compressed), {
        maxOutputLength: 64 * 1024 * 1024
      }),
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[
        color
      ]!,
      row = Math.ceil((width * channels * depth) / 8) + 1
    if (interlace === 0 && data.length !== row * height)
      throw new Error('PNG raster length mismatch')
    if (interlace === 0)
      for (let y = 0; y < height; y++)
        if (data[y * row]! > 4) throw new Error('Invalid PNG filter')
  } else if (mediaType === 'image/jpeg') {
    if (b.length < 16 || b[b.length - 2] !== 255 || b[b.length - 1] !== 217)
      throw new Error('Incomplete JPEG image')
    let cursor = 2,
      seenFrame = false,
      seenScan = false
    while (cursor < b.length - 2) {
      if (b[cursor++] !== 255) throw new Error('Invalid JPEG marker')
      while (b[cursor] === 255) cursor++
      const marker = b[cursor++]!
      if (marker === 218) {
        seenScan = true
        break
      }
      if (marker === 216 || marker === 217 || marker === 0)
        throw new Error('Unexpected JPEG marker')
      if (cursor + 2 > b.length) throw new Error('Truncated JPEG segment')
      const length = b.readUInt16BE(cursor)
      if (length < 2 || cursor + length > b.length)
        throw new Error('Truncated JPEG segment')
      if ([192, 193, 194].includes(marker)) {
        if (length < 8) throw new Error('Invalid JPEG frame')
        dimensions(b.readUInt16BE(cursor + 5), b.readUInt16BE(cursor + 3))
        seenFrame = true
      }
      cursor += length
    }
    if (!seenFrame || !seenScan) throw new Error('JPEG frame/scan missing')
  } else if (mediaType === 'image/webp') {
    if (b.length < 25 || b.readUInt32LE(4) + 8 !== b.length)
      throw new Error('Invalid WebP container')
    const type = b.toString('ascii', 12, 16),
      size = b.readUInt32LE(16)
    if (size + 20 > b.length) throw new Error('Truncated WebP image')
    if (type === 'VP8X') {
      if (size !== 10 || b.length < 30)
        throw new Error('Invalid WebP extended header')
      dimensions(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1)
    } else if (type === 'VP8L') {
      if (b[20] !== 47) throw new Error('Invalid lossless WebP')
      const bits = b.readUInt32LE(21)
      dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
    } else if (type === 'VP8 ') {
      if (size < 10 || b[23] !== 157 || b[24] !== 1 || b[25] !== 42)
        throw new Error('Invalid WebP frame')
      dimensions(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
    } else throw new Error('Unsupported WebP layout')
  } else throw new Error('Unsupported raster format')
}
