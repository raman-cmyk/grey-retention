import { BrandMark } from '@/components/brand/brand-mark'

export default function AuthLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <main className="grid min-h-screen bg-[var(--surface-raised)] text-[var(--text)] lg:grid-cols-[minmax(24rem,0.82fr)_1.18fr]">
      <section className="flex flex-col border-r border-[var(--line)] px-6 py-6 sm:px-10 lg:px-14 lg:py-10">
        <BrandMark />
        <div className="my-auto max-w-md py-16">{children}</div>
        <p className="font-[family-name:var(--font-data)] text-[0.65rem] tracking-[0.06em] text-[var(--text-faint)] uppercase">
          Campaign operations / controlled access
        </p>
      </section>
      <section className="relative hidden overflow-hidden bg-[var(--surface)] text-[var(--text)] lg:block">
        <div className="absolute inset-10 rounded-[var(--radius-panel)] bg-[var(--surface-raised)] shadow-[0_24px_65px_-42px_rgba(29,29,31,.28)]">
          <div className="flex h-14 items-center justify-between border-b border-[var(--line)] px-5">
            <span className="font-[family-name:var(--font-data)] text-[0.65rem] tracking-[0.08em] uppercase">
              Campaign proof / September
            </span>
            <span className="size-2 rounded-full bg-[var(--brand-primary)]" />
          </div>
          <div className="grid h-[calc(100%-3.5rem)] grid-cols-[1fr_13rem]">
            <div className="p-7">
              <div className="h-8 w-2/3 bg-[var(--text)]" />
              <div className="mt-3 h-2 w-1/2 bg-[var(--line-strong)]" />
              <div className="mt-12 grid grid-cols-5 gap-3">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((cell) => (
                  <div
                    key={cell}
                    className={`aspect-[4/3] rounded-[8px] ${cell === 7 ? 'bg-[var(--brand-primary)]' : 'bg-[var(--surface-hover)]'}`}
                  />
                ))}
              </div>
            </div>
            <div className="border-l border-[var(--line)] p-5">
              <div className="h-2 w-20 bg-[var(--line-strong)]" />
              <div className="mt-7 space-y-3">
                {[1, 2, 3, 4].map((line) => (
                  <div key={line} className="h-px bg-[var(--line)]" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
