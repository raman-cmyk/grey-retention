'use client'

import { useEffect, useRef, useState, type Ref } from 'react'

/** Fixed rendering canvas: typical email width plus a margin, bounded height. */
export const canvas = { width: 640, height: 800 }

/**
 * Shows already-sanitized email markup in an opaque sandboxed frame rendered
 * at a fixed canvas size and scaled down to fit its container. Only the
 * container's own width is measured; the frame's content is never read.
 * Longer emails scroll natively inside the frame.
 */
export function ScaledFrame({
  title,
  srcDoc,
  frameRef,
  height = canvas.height
}: {
  title: string
  srcDoc: string
  frameRef?: Ref<HTMLIFrameElement>
  /** Canvas height in px before scaling (default 800). */
  height?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const update = () =>
      setScale(Math.min(1, Math.max(0.3, element.clientWidth / canvas.width)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={box}
      data-testid="email-canvas"
      data-scale={scale.toFixed(3)}
      className="relative w-full overflow-hidden rounded-xl border border-[var(--line)] bg-white"
      style={{ height: height * scale }}
    >
      <iframe
        ref={frameRef}
        title={title}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        width={canvas.width}
        height={height}
        className="absolute top-0 left-1/2 block max-w-none origin-top border-0 bg-white"
        style={{
          width: canvas.width,
          height,
          transform: `translateX(-50%) scale(${scale})`
        }}
      />
    </div>
  )
}
