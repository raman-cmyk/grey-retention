'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/** Refreshes the page every few seconds while a plan step is running. */
export function PlanProgress({ message }: { message: string }) {
  const router = useRouter()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    let tries = 0
    const timer = setInterval(() => {
      tries++
      if (tries === 10) setSlow(true)
      if (tries > 40) return clearInterval(timer)
      router.refresh()
    }, 3000)
    return () => clearInterval(timer)
  }, [router])
  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded-lg bg-[var(--brand-soft)] p-4 text-sm leading-6 text-[var(--brand-ink)]"
    >
      {message}
      {slow &&
        ' This is taking longer than usual; you can leave this page and come back.'}
    </p>
  )
}
