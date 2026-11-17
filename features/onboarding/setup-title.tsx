'use client'

import { useEffect, useRef } from 'react'

/**
 * A setup step's one `h1`. A saved step sends the owner back to `/setup`,
 * and the form he used goes away; so when the step changes the new title
 * takes the focus (it is focusable by script only), and a screen reader
 * reads where he is now instead of losing its place.
 */
export function StepTitle({ text }: { text: string }) {
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    title.current?.focus()
  }, [text])
  return (
    <h1 ref={title} tabIndex={-1} className="type-title">
      {text}
    </h1>
  )
}
