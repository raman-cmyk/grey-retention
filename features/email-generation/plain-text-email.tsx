/** A plain-text email shown as text (no frame needed). */
export function PlainTextEmail({
  text,
  maxHeight
}: {
  text: string
  maxHeight?: number
}) {
  return (
    <div
      className="overflow-y-auto rounded-xl border border-[var(--line)] bg-white p-5"
      style={maxHeight ? { maxHeight } : undefined}
    >
      <p className="mb-2 text-xs text-[var(--text-muted)]">Plain-text email</p>
      {text.trim() ? (
        <p className="text-sm leading-6 break-words whitespace-pre-wrap text-[#1f1f1f]">
          {text}
        </p>
      ) : (
        <p className="text-sm text-[var(--text-muted)] italic">
          This email has no text.
        </p>
      )}
    </div>
  )
}
