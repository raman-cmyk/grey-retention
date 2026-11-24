import type { PolicyDraft } from './drafts'

/** A policy draft as a plain page: its draft notice first, always. */
export function PolicyPage({ draft }: { draft: PolicyDraft }) {
  return (
    <article>
      <p
        role="note"
        className="mb-6 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--text)]"
      >
        {draft.draftNotice}
      </p>
      <h1 className="tracking-display font-[family-name:var(--font-display)] text-3xl leading-tight font-normal">
        {draft.title}
      </h1>
      {draft.sections.map((s) => (
        <section key={s.heading} className="mt-8">
          <h2 className="text-lg font-semibold">{s.heading}</h2>
          {s.paragraphs.map((p, i) => (
            <p key={i} className="mt-3 text-sm leading-6 text-[var(--text)]">
              {p}
            </p>
          ))}
        </section>
      ))}
    </article>
  )
}
