'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { checkEmailProgress } from './actions'

/** Polls while a rewrite is writing; refreshes once it is saved or stops. */
export function RewriteProgress({ resultId }: { resultId: string }) {
  const router = useRouter()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    let active = true
    let tries = 0
    async function tick() {
      while (active && tries < 40) {
        tries++
        const { state } = await checkEmailProgress(resultId).catch(() => ({
          state: 'unknown'
        }))
        if (!active) return
        if (!['queued', 'running'].includes(state)) {
          router.refresh()
          return
        }
        if (tries === 10) setSlow(true)
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
      if (active) setSlow(true)
    }
    void tick()
    return () => {
      active = false
    }
  }, [resultId, router])
  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded-lg bg-[var(--brand-soft)] p-4 text-sm leading-6 text-[var(--brand-ink)]"
    >
      Writing your email… this usually takes under a minute.
      {slow &&
        ' Still working. If the AI service asks us to wait, the rewrite continues only while this page is open, so come back to this page to finish it.'}
    </p>
  )
}
