/**
 * The GROS mark (BRAND.md, draft): a forest disc with a lime open ring,
 * 36 to 44 px beside a page title. Never recoloured or stretched.
 */
export function Mark({ size = 44 }: { size?: 36 | 40 | 44 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      role="img"
      aria-label="GROS"
      className="shrink-0"
    >
      <circle cx="22" cy="22" r="22" fill="var(--forest)" />
      <path
        d="M30.5 14.5a12 12 0 1 0 1.5 11.5"
        fill="none"
        stroke="var(--lime)"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
