import { BlockList, isIP } from 'node:net'

/**
 * Private, local and reserved addresses (IPv4 and IPv6, with IPv4 inside
 * IPv6): loopback, private networks, link-local, CGNAT, the cloud metadata
 * address (169.254.169.254), documentation and multicast ranges. A leaf
 * module (no `server-only`), shared by the inbox's picture fetcher and the
 * design engine's photo fetcher (which runs in a plain Node browser job).
 */
const reserved = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3]
] as const)
  reserved.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [
  // ::/96 covers ::, ::1 and the old IPv4-compatible form ::a.b.c.d.
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const)
  reserved.addSubnet(net, bits, 'ipv6')

/** True when an address is private, local or reserved (also IPv4 in IPv6). */
export function reservedAddress(address: string) {
  const bare = address.replace(/^\[|\]$/g, '')
  const family = isIP(bare)
  if (family === 4) return reserved.check(bare, 'ipv4')
  if (family !== 6) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare)
  if (mapped) return reserved.check(mapped[1]!, 'ipv4')
  return reserved.check(bare, 'ipv6')
}
