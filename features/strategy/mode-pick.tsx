/**
 * DST-002b part c: how a designed email is made, chosen next to Create
 * email (D25): from scratch, by copying an Inspiration email's layout, or
 * by remixing its idea. The build picks the email itself and says which,
 * or why it made the email from scratch. A text email has no choice.
 * Basic look on the GROS tokens (a field: real label, 44 px, radius md);
 * its design comes with the polish.
 */
export const modeChoices = [
  { value: 'scratch', label: 'From scratch' },
  { value: 'copy', label: 'Copy an inspiration email' },
  { value: 'remix', label: 'Remix an inspiration email' }
] as const

export function ModePick({ slot, title }: { slot: number; title: string }) {
  const id = `email-mode-${slot}`
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <label htmlFor={id} className="gros-field-label text-[var(--ink)]">
        How to make it
      </label>
      <select
        id={id}
        name="mode"
        defaultValue="scratch"
        aria-label={`How to make ${title}`}
        className="type-body min-h-[var(--control-sm)] rounded-[var(--radius-md)] bg-[var(--mist)] px-[var(--space-4)] text-[var(--ink)]"
      >
        {modeChoices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  )
}
