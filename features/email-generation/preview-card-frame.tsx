'use client'

import { Maximize, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'

/**
 * Client half of the email preview card: the header with Fullscreen and
 * Refresh, and the sandboxed frame. `srcDoc` must come from `previewHtml`
 * (links, scripts, forms and outside loads already removed); the frame adds
 * an empty `sandbox` so nothing in it can run, navigate or reach this site.
 */
export function PreviewCardFrame({
  title,
  templateName,
  srcDoc,
  text,
  caption,
  notes,
  height
}: {
  title: string
  templateName?: string
  srcDoc: string | null
  text: string
  caption: string
  notes: string[]
  height: number
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [version, setVersion] = useState(0)
  const [canFullscreen, setCanFullscreen] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    setCanFullscreen(
      Boolean(document.fullscreenEnabled && frame.current?.requestFullscreen)
    )
  }, [srcDoc])
  const fullscreen = async () => {
    setMessage('')
    try {
      await frame.current?.requestFullscreen()
    } catch {
      setMessage('Fullscreen is not available here. The preview stays below.')
    }
  }
  return (
    <section
      aria-label={title}
      className="rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6"
    >
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">Email preview</h2>
        {templateName && (
          <Pill mono className="max-w-[16rem]" title={templateName}>
            {templateName}
          </Pill>
        )}
        {srcDoc !== null && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              shape="pill"
              size="sm"
              disabled={!canFullscreen}
              onClick={fullscreen}
            >
              <Maximize className="size-4" aria-hidden />
              Fullscreen
            </Button>
            <Button
              type="button"
              variant="outline"
              shape="pill"
              size="sm"
              onClick={() => {
                setVersion((value) => value + 1)
                setMessage('Preview reloaded.')
              }}
            >
              <RefreshCw className="size-4" aria-hidden />
              Refresh
            </Button>
          </div>
        )}
      </header>
      <div className="rounded-[var(--radius-control)] bg-[var(--surface-hover)] p-3">
        {srcDoc === null ? (
          <div
            className="overflow-y-auto rounded-sm bg-white p-5"
            style={{ maxHeight: height }}
          >
            <p className="mb-2 text-xs text-[var(--text-muted)]">
              Plain-text email
            </p>
            <p className="text-sm leading-6 break-words whitespace-pre-wrap text-[#1f1f1f]">
              {text}
            </p>
          </div>
        ) : (
          <iframe
            key={version}
            ref={frame}
            title={title}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
            className="block w-full rounded-sm border-0 bg-white"
            style={{ height }}
          />
        )}
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
        {caption}
        {notes.length > 0 && ` In this one: ${notes.join(', ')}.`}
      </p>
      <p
        role="status"
        className="mt-1 text-xs text-[var(--text-muted)] empty:hidden"
      >
        {message}
      </p>
    </section>
  )
}
