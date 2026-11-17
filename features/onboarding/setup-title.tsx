'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Around the open step: a saved step sends the owner back to `/setup` and
 * the form he used goes away, so when the step changes, its title (the one
 * `h1`, focusable by script only) takes the focus and a screen reader reads
 * where he is now. It stays across steps, so the first time setup opens
 * nothing moves the focus (and no focus ring shows).
 */
export function StepFocus({
  step,
  children
}: {
  step: string
  children: ReactNode
}) {
  const area = useRef<HTMLDivElement>(null)
  const shown = useRef<string | null>(null)
  useEffect(() => {
    if (shown.current !== null && shown.current !== step)
      area.current?.querySelector<HTMLElement>('h1')?.focus()
    shown.current = step
  }, [step])
  return (
    <div ref={area} className="contents">
      {children}
    </div>
  )
}
