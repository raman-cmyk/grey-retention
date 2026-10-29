'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { checkFileImport } from './actions'

/**
 * While a file waits or is being read, asks the server to resume it and
 * refreshes when the persisted state changes. Stops after a bounded wait.
 */
export function FileImportProgress({
  importId,
  state
}: {
  importId: string
  state: string
}) {
  const router = useRouter()
  const [stalled, setStalled] = useState(false)
  const checks = useRef(0)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      checks.current += 1
      const next = await checkFileImport(importId).catch(() => ({
        state: 'unknown' as const
      }))
      if (!active) return
      if (next.state !== state && next.state !== 'unknown') {
        router.refresh()
        return
      }
      if (checks.current >= 40) {
        setStalled(true)
        return
      }
      timer = setTimeout(tick, Math.min(1000 + checks.current * 250, 4000))
    }
    timer = setTimeout(tick, 600)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [importId, state, router])
  return (
    <p role="status" className="text-sm leading-6">
      {stalled
        ? 'This is taking longer than usual. Your file is saved; reload this page to check again.'
        : state === 'processing'
          ? 'Reading your file…'
          : 'Your file is saved and waiting to be read…'}
    </p>
  )
}
