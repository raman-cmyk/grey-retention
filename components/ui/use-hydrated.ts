'use client'
import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * False while the server renders and while React hydrates the page, true
 * once the page's JavaScript runs. Controls that only work with JavaScript
 * (a server-action submit, a dialog trigger) stay disabled until then, so a
 * fast click on a slow page is never lost (the form would otherwise post
 * natively and drop its result message).
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
}
