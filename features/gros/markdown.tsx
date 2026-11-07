import { Fragment, type ReactNode } from 'react'

/**
 * A tiny, safe Markdown subset for GROS replies (spec §8): paragraphs,
 * line breaks, `- ` / `* ` bullet lists, `1. ` numbered lists and
 * `**bold**`. Everything else stays plain text. It builds React elements
 * only — no HTML string, no links — so a reply can never inject markup.
 */
type Block =
  { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] }

const bullet = /^\s*[-*]\s+(.*)$/
const numbered = /^\s*\d+[.)]\s+(.*)$/

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const b = bullet.exec(line)
    const n = b ? null : numbered.exec(line)
    const last = blocks.at(-1)
    if (b || n) {
      const kind = b ? 'ul' : 'ol'
      const item = (b ?? n)![1]!
      if (last?.kind === kind) last.items.push(item)
      else blocks.push({ kind, items: [item] })
    } else if (line.trim() === '') {
      if (last && !(last.kind === 'p' && last.lines.length === 0))
        blocks.push({ kind: 'p', lines: [] })
    } else if (last?.kind === 'p') last.lines.push(line)
    else blocks.push({ kind: 'p', lines: [line] })
  }
  return blocks.filter((b) =>
    b.kind === 'p' ? b.lines.length : b.items.length
  )
}

/** `**bold**` inside one line; an unmatched `**` stays as typed. */
export function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+?\*\*)/g)
  return parts
    .filter((part) => part !== '')
    .map((part, i) =>
      /^\*\*[^*\n]+?\*\*$/.test(part) ? (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      )
    )
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-3">
      {parseBlocks(text).map((block, i) =>
        block.kind === 'p' ? (
          <p key={i} className="break-words">
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        ) : block.kind === 'ul' ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j} className="break-words">
                {inline(item)}
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j} className="break-words">
                {inline(item)}
              </li>
            ))}
          </ol>
        )
      )}
    </div>
  )
}
