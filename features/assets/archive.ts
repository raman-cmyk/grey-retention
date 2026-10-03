import { crc32 } from '@/lib/binary'
import { validateRaster } from './raster'
export { crc32 } from '@/lib/binary'
import { inflateRawSync } from 'node:zlib'
import { validateDesignBytes } from '@/features/designers/uploads'
export const intakeLimits = {
  files: 100,
  compressed: 10 * 1024 * 1024,
  expanded: 20 * 1024 * 1024
}
export type IntakeFile = {
  name: string
  bytes: Uint8Array
  mediaType: string
  extension: string
}
export type IntakeFailure = { name: string; error: string }
export function safeArchivePath(name: string) {
  if (
    !name ||
    name.length > 250 ||
    /[\\:\x00-\x1f]/.test(name) ||
    name.startsWith('/') ||
    name.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('Unsafe archive path')
  return name
}
export function inspectAsset(name: string, bytes: Uint8Array): IntakeFile {
  safeArchivePath(name)
  const media = validateDesignBytes(bytes, name)
  validateRaster(bytes, media.mediaType)
  return { name, bytes, ...media }
}
// Central-directory parser: never extracts paths to disk; ZIP64, encryption, links and nested archives are unavailable.
export function unpackAssetZip(input: Uint8Array): {
  files: IntakeFile[]
  failures: IntakeFailure[]
} {
  const zip = Buffer.from(input)
  if (zip.length < 22 || zip.length > intakeLimits.compressed)
    throw new Error('ZIP exceeds the 10 MiB intake limit or is truncated')
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--)
    if (
      zip.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + zip.readUInt16LE(i + 20) === zip.length
    ) {
      end = i
      break
    }
  if (
    end < 0 ||
    zip.readUInt16LE(end + 4) !== 0 ||
    zip.readUInt16LE(end + 6) !== 0
  )
    throw new Error('Unsupported ZIP directory')
  const count = zip.readUInt16LE(end + 10),
    start = zip.readUInt32LE(end + 16),
    size = zip.readUInt32LE(end + 12)
  if (
    count > intakeLimits.files ||
    count === 0 ||
    count !== zip.readUInt16LE(end + 8) ||
    start + size !== end
  )
    throw new Error('ZIP file count or directory exceeds supported limits')
  const files: IntakeFile[] = [],
    failures: IntakeFailure[] = [],
    names = new Set<string>()
  let cursor = start,
    expanded = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || zip.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('Corrupt ZIP directory')
    const flags = zip.readUInt16LE(cursor + 8),
      method = zip.readUInt16LE(cursor + 10),
      crc = zip.readUInt32LE(cursor + 16),
      packed = zip.readUInt32LE(cursor + 20),
      length = zip.readUInt32LE(cursor + 24),
      nameLength = zip.readUInt16LE(cursor + 28),
      extra = zip.readUInt16LE(cursor + 30),
      comment = zip.readUInt16LE(cursor + 32),
      local = zip.readUInt32LE(cursor + 42),
      mode = zip.readUInt32LE(cursor + 38) >>> 16
    if (cursor + 46 + nameLength + extra + comment > end)
      throw new Error('Truncated ZIP entry')
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      zip.subarray(cursor + 46, cursor + 46 + nameLength)
    )
    cursor += 46 + nameLength + extra + comment
    if (length === 0 && name.endsWith('/')) {
      safeArchivePath(name.slice(0, -1))
      continue
    }
    expanded += length
    if (
      expanded > intakeLimits.expanded ||
      length > 10 * 1024 * 1024 ||
      packed > intakeLimits.compressed
    )
      throw new Error('ZIP expanded size exceeds limits')
    try {
      safeArchivePath(name)
      if (names.has(name)) throw new Error('Duplicate ZIP filename')
      names.add(name)
      if (
        (flags & ~0x808) !== 0 ||
        (method !== 0 && method !== 8) ||
        (mode & 0xf000) === 0xa000
      )
        throw new Error(
          'Unsupported ZIP entry (encryption, link or compression)'
        )
      if (
        local + 30 > start ||
        zip.readUInt32LE(local) !== 0x04034b50 ||
        zip.readUInt16LE(local + 8) !== method ||
        zip.readUInt16LE(local + 6) !== flags
      )
        throw new Error('ZIP local header mismatch')
      const localNameLength = zip.readUInt16LE(local + 26),
        localExtra = zip.readUInt16LE(local + 28),
        dataStart = local + 30 + localNameLength + localExtra
      if (
        dataStart + packed > start ||
        new TextDecoder('utf-8', { fatal: true }).decode(
          zip.subarray(local + 30, local + 30 + localNameLength)
        ) !== name
      )
        throw new Error('ZIP path or range mismatch')
      const compressed = zip.subarray(dataStart, dataStart + packed)
      const bytes =
        method === 0
          ? compressed
          : inflateRawSync(compressed, {
              maxOutputLength: Math.min(length + 1, 10 * 1024 * 1024 + 1)
            })
      if (bytes.length !== length || crc32(bytes) !== crc)
        throw new Error('ZIP checksum mismatch')
      files.push(inspectAsset(name, bytes))
    } catch (error) {
      failures.push({
        name,
        error: error instanceof Error ? error.message : 'Invalid ZIP entry'
      })
    }
  }
  if (cursor !== end)
    throw new Error('ZIP directory contains unrecognized data')
  return { files, failures }
}
