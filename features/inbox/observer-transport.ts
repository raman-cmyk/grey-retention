import 'server-only'
import { ImapFlow, type ImapFlowOptions } from 'imapflow'
import {
  InboundTransportError,
  type InboundCaptureTransport,
  type InboundSession
} from '@/lib/providers/inbound-capture'
import {
  gmailOptions,
  imapError,
  type ImapClient,
  type ImapConfig
} from './imap'
import { readInboxMessage } from './mime'
import {
  selectionVersion,
  type ObserverEmail,
  type ObserverSelection
} from './observer-sheet'

export type ObserverImap = ImapClient & Pick<ImapFlow, 'list'>
const refuse = () =>
  new InboundTransportError('protocol', 'observer_message_not_approved')
const same = (a: ObserverEmail, b: ObserverEmail) =>
  JSON.stringify(a) === JSON.stringify(b)

/** Sheet-selected originals, including older mail approved after it arrived.
 * The cursor belongs to the selected set, not Gmail's arrival order.
 * Uses existing Gmail credentials, exact message IDs, and read-only folders.
 */
export function observerGmailTransport(
  config: ImapConfig,
  selection: ObserverSelection,
  connect: (o: ImapFlowOptions) => ObserverImap = (o) => new ImapFlow(o)
): InboundCaptureTransport {
  const at = config.user.lastIndexOf('@')
  return {
    kind: 'gmail_imap',
    mailbox: 'gmail',
    synthetic: false,
    base: {
      local: config.user.slice(0, at),
      domain: config.user.slice(at + 1)
    },
    async open(): Promise<InboundSession> {
      const rows = (await selection.read()).sort((a, b) =>
          a.id.localeCompare(b.id)
        ),
        version = selectionVersion(rows)
      const selected = new Map<
        number,
        { entry: ObserverEmail; folder: string; uid: number }
      >()
      const client = connect(gmailOptions(config))
      client.on('error', () => {})
      let release: (() => void) | undefined
      try {
        if (rows.length) await client.connect()
        const folders = rows.length
          ? (await client.list())
              .filter((f) =>
                ['\\All', '\\Junk', '\\Trash'].includes(f.specialUse ?? '')
              )
              .map((f) => f.path)
          : []
        if (rows.length && !folders.length) throw refuse()
        const lock = async (folder: string) => {
          release?.()
          release = undefined
          release = (await client.getMailboxLock(folder, { readOnly: true }))
            .release
        }
        const approved = async (entry: ObserverEmail) => {
          const current = (await selection.read()).find(
            (e) => e.id === entry.id
          )
          if (!current || !same(current, entry)) throw refuse()
        }
        return {
          async list(cursor, limit) {
            const start = cursor.uidValidity === version ? cursor.lastUid : 0,
              messages = []
            let scannedThrough = start
            const until = Date.now() + 6000
            for (
              let i = start;
              i < rows.length && messages.length < limit && Date.now() < until;
              i++
            ) {
              scannedThrough = i + 1
              const entry = rows[i]
              let found: { folder: string; uid: number } | undefined
              for (const folder of folders) {
                await lock(folder)
                const ids = await client.search(
                  /^[a-f0-9]{1,16}$/.test(entry.gmailId)
                    ? { emailId: BigInt('0x' + entry.gmailId).toString() }
                    : { gmailraw: 'rfc822msgid:' + entry.messageId },
                  { uid: true }
                )
                if (ids === false || ids.length > 1) throw refuse()
                if (ids.length) {
                  if (found) throw refuse()
                  found = { folder, uid: ids[0] }
                }
              }
              if (!found) continue
              await lock(found.folder)
              const meta = await client.fetchOne(
                String(found.uid),
                { size: true, internalDate: true },
                { uid: true }
              )
              if (!meta || !meta.size) throw refuse()
              selected.set(i + 1, { entry, ...found })
              messages.push({
                uid: i + 1,
                size: meta.size,
                transportId: 'observer:' + entry.id,
                internalDate: new Date(
                  meta.internalDate ?? Date.now()
                ).toISOString()
              })
            }
            return {
              uidValidity: version,
              messages,
              scannedThrough,
              more: scannedThrough < rows.length
            }
          },
          async fetchRaw(uid, maxBytes) {
            const match = selected.get(uid)
            if (!match) throw refuse()
            await approved(match.entry)
            await lock(match.folder)
            const result = await client.fetchOne(
              String(match.uid),
              { source: { maxLength: maxBytes + 1 } },
              { uid: true }
            )
            if (!result || !result.source) throw refuse()
            const raw = new Uint8Array(result.source)
            if (raw.length > maxBytes)
              throw new InboundTransportError('too_large', 'message_too_large')
            const parsed = await readInboxMessage(raw)
            if (
              !parsed ||
              !parsed.recipients
                .map((a) => a.toLowerCase())
                .includes(match.entry.alias) ||
              parsed.fromAddress?.toLowerCase() !== match.entry.sender ||
              (match.entry.messageId &&
                parsed.messageId !== match.entry.messageId)
            )
              throw new InboundTransportError(
                'protocol',
                'observer_identity_mismatch'
              )
            await approved(match.entry)
            return raw
          },
          captureDomain(uid) {
            return selected.get(uid)?.entry.domain ?? null
          },
          async markProcessed() {
            /* Observer's receiving mailbox is never mutated. */
          },
          async close() {
            release?.()
            await client.logout().catch(() => {})
          }
        }
      } catch (error) {
        release?.()
        await client.logout().catch(() => {})
        throw imapError(error)
      }
    }
  }
}
