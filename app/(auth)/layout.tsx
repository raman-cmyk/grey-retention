import { BrandMark } from '@/components/brand/brand-mark'

export default function AuthLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col bg-[var(--surface)] text-[var(--text)]">
      <header className="px-6 py-6 sm:px-10">
        <BrandMark />
      </header>
      <section className="mx-auto my-auto w-full max-w-xl px-6 py-10 sm:py-16">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-6 sm:p-10">
          {children}
        </div>
      </section>
      <p className="px-6 pb-6 text-center text-xs text-[var(--text-faint)]">
        Your brand. Your next email. One step at a time.
      </p>
    </main>
  )
}
