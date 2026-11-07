'use client'

import { Maximize, RefreshCw } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { PlainTextEmail } from './plain-text-email'
import type { SafePreview } from './safe-preview'
import { ScaledFrame } from './scaled-frame'

/**
 * Client half of the email preview card: the header with Fullscreen and
 * Refresh, and the sandboxed, scaled frame. It only accepts a `SafePreview`
 * made on the server by `EmailPreviewCard`.
 */
export function PreviewCardFrame({
  title,
  templateName,
  preview,
  text,
  caption,
  notes,
  height,
  textHeading
}: {
  title: string
  templateName?: string
  preview: SafePreview | null
  text: string
  caption: string
  notes: string[]
  height: number
  /** The label above `text` when there is no design ("Plain-text email"). */
  textHeading?: string
}) {
  const headingId = useId()
  const frame = useRef<HTMLIFrameElement>(null)
  const [version, setVersion] = useState(0)
  const [canFullscreen, setCanFullscreen] = useState(false)
  const [message, setMessage] = useState('')
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    setCanFullscreen(
      Boolean(document.fullscreenEnabled && frame.current?.requestFullscreen)
    )
  }, [preview, version])
  // Clear, then set, so the same words are announced again.
  const say = (text: string, visible = false) => {
    setMessage(visible ? text : '')
    setAnnouncement('')
    window.setTimeout(() => setAnnouncement(text), 30)
  }
  const fullscreen = async () => {
    setMessage('')
    try {
      await frame.current?.requestFullscreen()
    } catch {
      say('Fullscreen is not available here. The preview stays below.', true)
    }
  }
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6"
    >
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h2 id={headingId} className="text-base font-semibold">
          Email preview
        </h2>
        {templateName && (
          <Pill mono className="max-w-[16rem]" title={templateName}>
            {templateName}
          </Pill>
        )}
        {preview && (
          <div className="ml-auto flex flex-wrap gap-2">
            {canFullscreen && (
              <Button
                type="button"
                variant="outline"
                shape="pill"
                size="sm"
                onClick={fullscreen}
              >
                <Maximize className="size-4" aria-hidden />
                Fullscreen
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              shape="pill"
              size="sm"
              onClick={() => {
                setVersion((value) => value + 1)
                say('Preview reloaded.')
              }}
            >
              <RefreshCw className="size-4" aria-hidden />
              Refresh
            </Button>
          </div>
        )}
      </header>
      <div className="rounded-[var(--radius-control)] bg-[var(--surface-hover)] p-3">
        {preview ? (
          <ScaledFrame
            key={version}
            frameRef={frame}
            title={title}
            srcDoc={preview.html}
            height={height}
          />
        ) : (
          <PlainTextEmail
            text={text}
            maxHeight={height}
            heading={textHeading}
          />
        )}
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
        {caption}
        {notes.length > 0 && ` In this one: ${notes.join(', ')}.`}
      </p>
      {message && (
        <p className="mt-1 text-xs text-[var(--text-muted)]">{message}</p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  )
}
