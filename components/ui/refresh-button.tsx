'use client'

import { RefreshCw } from 'lucide-react'
import { useFormStatus } from 'react-dom'
import { Button } from './button'

/** Outline `⟳ Refresh` for a page header; put it inside a form with an action. */
export function RefreshButton({ label = 'Refresh' }: { label?: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" shape="pill" disabled={pending}>
      <RefreshCw
        className="size-4 motion-safe:data-[pending]:animate-spin"
        data-pending={pending || undefined}
        aria-hidden
      />
      {pending ? 'Refreshing…' : label}
    </Button>
  )
}
