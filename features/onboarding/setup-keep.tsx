'use client'

import { useState, type ReactNode } from 'react'

/**
 * The Brand step refreshes itself while the readers run (UI-ONBc). These
 * keep what the owner already has on screen through a refresh:
 */

/** Once shown, stays shown: a refresh never takes away a form he may be typing in. */
export function KeepShown({
  show,
  children
}: {
  show: boolean
  children: ReactNode
}) {
  const [shown, setShown] = useState(show)
  if (show && !shown) setShown(true)
  return shown || show ? children : null
}

/** The last good content, kept when a later read of it fails. */
export function KeepLast({
  children,
  fallback
}: {
  /** Null when this read failed. */
  children: ReactNode
  fallback: ReactNode
}) {
  const [last, setLast] = useState<ReactNode>(children)
  if (children && children !== last) setLast(children)
  return children ?? last ?? fallback
}
