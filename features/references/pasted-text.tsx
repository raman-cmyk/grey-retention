import { pastedLimits, readableAtLimit } from './pasted'

// Rendered as React text only: pasted markup is shown, never interpreted.
export function PastedText({
  text,
  limited = readableAtLimit(text),
  saved = true
}: {
  text: string
  limited?: boolean
  saved?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="max-h-72 overflow-auto rounded-lg bg-[var(--surface-hover)] p-3 text-sm leading-6 break-words whitespace-pre-wrap">
        {text}
      </div>
      {limited && (
        <p className="text-xs leading-5 text-[var(--text-muted)]">
          Preview limited to the first{' '}
          {pastedLimits.readable.toLocaleString('en')} readable characters. The
          full email you pasted {saved ? 'is' : 'will be'} saved unchanged.
        </p>
      )}
    </div>
  )
}
