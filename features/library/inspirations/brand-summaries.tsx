import { Pill } from '@/components/ui/pill'
import { blockCatalog } from '@/features/blocks/catalog'
import type { Pattern, TrackedSummary } from '@/features/inbox/brand-summary'
import type { Angle } from '@/features/inbox/facts'

/** Plain names for the campaign angles and offers. */
const angleWords: Record<Angle, string> = {
  restock: 'Back in stock',
  seasonal: 'Seasonal',
  launch: 'New arrivals',
  sale: 'Sale',
  bestseller: 'Best sellers',
  social_proof: 'Reviews',
  story: 'Brand story',
  education: 'How-to',
  bundle: 'Bundles',
  other: 'Other'
}
const offerWords: Record<Pattern['offer'], string> = {
  percent: 'a % off',
  amount: 'money off',
  bogo: 'buy one get one',
  gift: 'a free gift',
  free_shipping: 'free shipping',
  none: 'no offer'
}
const blockNames = new Map(
  blockCatalog.map((b) => [b.type as string, b.name.toLowerCase()])
)
const blockWords = (type: string) =>
  blockNames.get(type) ?? type.replace(/_/g, ' ')
const pct = (share: number) => `${Math.round(share * 100)}%`

function patternText(p: Pattern) {
  const opening = p.opening.length
    ? `, opening with ${p.opening.map(blockWords).join(' → ')}`
    : ''
  return `${angleWords[p.angle]} with ${offerWords[p.offer]}${opening}`
}

/**
 * What each followed brand sends (INB-003), from its own labelled emails:
 * how often, the kinds of campaign, offers, text:design, when, and the
 * patterns it repeats (counted more than a one-off).
 */
export function BrandSummaries({ brands }: { brands: TrackedSummary[] }) {
  if (!brands.length) return null
  return (
    <section aria-labelledby="what-they-send" className="space-y-3">
      <h2 id="what-they-send" className="text-lg font-semibold">
        What they send
      </h2>
      <ul className="grid gap-3 md:grid-cols-2" aria-label="Brand summaries">
        {brands.map(({ domain, label, sample, summary: s }) => {
          const repeated = s.patterns.filter((p) => p.repeated)
          const once = s.patterns.filter((p) => !p.repeated)
          return (
            <li
              key={domain}
              className="space-y-2 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-4 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">
                  {label}
                  {label !== domain && (
                    <span className="font-normal text-[var(--text-muted)]">
                      {' '}
                      {domain}
                    </span>
                  )}
                </h3>
                {sample && <Pill>Sample</Pill>}
              </div>
              <p>
                {s.emails} {s.emails === 1 ? 'email' : 'emails'} in the last{' '}
                {s.windowDays} days (about {s.perWeek} a week).
              </p>
              <p>
                <span className="text-[var(--text-muted)]">Mostly: </span>
                {s.angles
                  .slice(0, 3)
                  .map((a) => `${angleWords[a.angle]} ${pct(a.share)}`)
                  .join(' · ')}
              </p>
              <p>
                <span className="text-[var(--text-muted)]">Offers: </span>
                {s.discount.share === 0
                  ? 'none'
                  : `in ${pct(s.discount.share)} of emails${
                      s.discount.typicalPercent !== null
                        ? `, usually ${s.discount.typicalPercent}% off`
                        : ''
                    }`}
              </p>
              {s.textRatio !== null && (
                <p>
                  <span className="text-[var(--text-muted)]">Layout: </span>
                  text {pct(s.textRatio)} · design {pct(1 - s.textRatio)}
                </p>
              )}
              {s.sends && (
                <p>
                  <span className="text-[var(--text-muted)]">Sends: </span>
                  usually {s.sends.day} around{' '}
                  {String(s.sends.hour).padStart(2, '0')}:00 your time
                </p>
              )}
              {repeated.length > 0 && (
                <div>
                  <p className="text-[var(--text-muted)]">
                    Repeats (what seems to work):
                  </p>
                  <ul className="list-disc pl-5">
                    {repeated.map((p) => (
                      <li key={patternText(p)}>
                        {patternText(p)} — {p.count}×
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {once.length > 0 && (
                <p className="text-xs text-[var(--text-muted)]">
                  Tried once: {once.map(patternText).join('; ')}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
