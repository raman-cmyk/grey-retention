/**
 * DST-002b part c: how a designed email is made, chosen next to Create
 * email (D25): from scratch, by copying an Inspiration email's layout, or
 * by remixing its idea. The build picks the email itself and says which,
 * or why it made the email from scratch. A text email has no choice.
 */
export const modeChoices = [
  { value: 'scratch', label: 'From scratch' },
  { value: 'copy', label: 'Copy an inspiration email' },
  { value: 'remix', label: 'Remix an inspiration email' }
] as const

export function ModePick({ title }: { title: string }) {
  return (
    <select
      name="mode"
      defaultValue="scratch"
      aria-label={`How to make ${title}`}
      className="type-caption rounded-[var(--radius-pill)] bg-[var(--mist)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--ink)] focus:outline-2 focus:outline-[var(--forest)]"
    >
      {modeChoices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  )
}
