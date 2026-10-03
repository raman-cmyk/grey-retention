import { deflateRawSync } from 'node:zlib'
import { crc32 } from '../../features/assets/archive'
export function assetZip(
  entries: {
    name: string
    bytes: Uint8Array
    deflate?: boolean
    mode?: number
    length?: number
    crc?: number
  }[]
) {
  const locals: Buffer[] = [],
    directories: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name),
      content = Buffer.from(e.bytes),
      packed = e.deflate ? deflateRawSync(content) : content,
      crc = e.crc ?? crc32(content),
      length = e.length ?? content.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(e.deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, packed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(e.deflate ? 8 : 0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(((e.mode ?? 0) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    directories.push(central, name)
    offset += local.length + name.length + packed.length
  }
  const directory = Buffer.concat(directories),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
