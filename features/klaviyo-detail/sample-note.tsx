/** The one sample-data line every Klaviyo page shows (fake provider). */
export function SampleNote() {
  return (
    <p className="text-xs text-[var(--text-muted)]">
      <strong className="font-semibold text-[var(--warning-ink)]">
        Sample Klaviyo data
      </strong>{' '}
      — made up for this preview, not synced from a real account.
    </p>
  )
}
