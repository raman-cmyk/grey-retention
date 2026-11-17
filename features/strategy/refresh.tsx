'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * While the planner or an email's agents work, the Plan screen reads itself
 * again every few seconds (at most two minutes), and says when it is slow.
 */
export function KeepFresh() {
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
  return slow ? (
    <p role="status" className="type-caption text-[var(--stone)]">
      This is taking longer than usual. You can leave this page and come back.
    </p>
  ) : null
}
