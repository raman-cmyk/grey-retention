'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/** The three ways to look at an email (UI-EMAIL-b). */
export const views = ['Desktop', 'Phone', 'Dark'] as const
export type View = (typeof views)[number]

/** How wide the inbox is for each view, in px. */
const widths: Record<View, number> = { Desktop: 640, Phone: 375, Dark: 640 }

/**
 * A dark inbox, roughly: the colours turned around as many apps do, the
 * pictures kept as they are. Inline styles are what the preview's own
 * Content-Security-Policy allows.
 */
export function darkDocument(html: string) {
  const style =
    '<style>html{background:#121212}body{filter:invert(1) hue-rotate(180deg)}img{filter:invert(1) hue-rotate(180deg)}</style>'
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${style}</head>`)
    : `${style}${html}`
}

/**
 * An email's design in a sandboxed frame (already made safe on the server:
 * active content and outside loads removed, Klaviyo's tags as words), at
 * desktop or phone width, or roughly as a dark inbox shows it. The frame is
 * scaled down to fit, never read.
 */
export function EmailViews({ name, html }: { name: string; html: string }) {
  const [view, setView] = useState<View>('Desktop')
  const box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(640)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const update = () => setRoom(element.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const width = widths[view]
  const scale = Math.min(1, Math.max(0.3, room / width))
  const height = 1400
  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div
        role="group"
        aria-label={`How to look at ${name}`}
        className="flex flex-wrap gap-[var(--space-2)]"
      >
        {views.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn(
              'type-body-strong rounded-[var(--radius-pill)] px-[var(--space-5)] py-[var(--space-2)]',
              view === v
                ? 'bg-[var(--forest)] text-[var(--white)]'
                : 'bg-[var(--mist)] text-[var(--ink)]'
            )}
          >
            {v}
          </button>
        ))}
      </div>
      <div
        ref={box}
        className="relative w-full overflow-hidden rounded-[var(--radius-md)] bg-[var(--mist)]"
        style={{ height: height * scale }}
      >
        <iframe
          title={`${name}, ${view.toLowerCase()} view`}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={view === 'Dark' ? darkDocument(html) : html}
          className="absolute top-0 left-1/2 block max-w-none origin-top border-0 bg-white"
          style={{
            width,
            height,
            transform: `translateX(-50%) scale(${scale})`
          }}
        />
      </div>
      {view === 'Dark' && (
        <p className="type-caption text-[var(--stone)]">
          Roughly how an inbox in dark mode shows it: each email app turns
          colours around in its own way.
        </p>
      )}
    </div>
  )
}
