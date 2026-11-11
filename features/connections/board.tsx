'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Mail, Plus, TriangleAlert } from 'lucide-react'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { StatusMark } from '@/components/ui/status-mark'
import { TextField } from '@/components/ui/text-field'
import { Field } from '@/components/ui/workspace'
import { connectKlaviyo } from './actions'

/** What the screen needs from one `workspace_connections` row. */
export type ConnectionView = {
  status: string
  accountLabel: string | null
  credentialHint: string | null
  templateCount: number | null
  /** 'live' once a real key was checked with Klaviyo (KLV-001). */
  mode?: 'fixture' | 'live'
}

const sampleNote =
  'Sample mode: we check the format only. Nothing is sent to the provider, and the full key is never saved — only the masked hint.'
const liveNote =
  'We check this key with Klaviyo. We only read your Klaviyo data. The key is stored encrypted.'
const secretProps = {
  type: 'password',
  autoComplete: 'off',
  spellCheck: false,
  required: true,
  'data-1p-ignore': true,
  'data-lpignore': 'true'
} as const

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="flex h-full flex-col gap-5 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6">
      {children}
    </section>
  )
}

function Tile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--brand-soft)] text-[var(--brand-ink)]"
    >
      {children}
    </span>
  )
}

function Benefits({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm text-[var(--text)]">
      {items.map((item) => (
        <li key={item} className="flex items-center gap-2">
          <Plus
            className="size-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {item}
        </li>
      ))}
    </ul>
  )
}

/**
 * Looks like the accent button, but is a status, not an action. When the card
 * flips to connected, focus moves here so keyboard and screen-reader users
 * land on the new state instead of the page body.
 */
function ConnectedBadge({ label }: { label: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (document.activeElement === document.body) ref.current?.focus()
  }, [])
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="status"
      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--brand-secondary)] px-4 text-sm font-medium text-[var(--on-brand-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
    >
      <Check className="size-4" aria-hidden="true" />
      {label}
    </p>
  )
}

/** Shown when a saved connection stopped working (expired or failing). */
function NeedsAttention({
  connection,
  action
}: {
  connection: ConnectionView | null
  action: string
}) {
  if (!connection || !['expired', 'error'].includes(connection.status))
    return null
  return (
    <p className="flex gap-2 text-sm text-[var(--danger-ink)]">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        {connection.status === 'expired'
          ? 'This connection has expired.'
          : 'This connection stopped working.'}{' '}
        {action}
      </span>
    </p>
  )
}

/** Text link styled toggle that reports and keeps its open state. */
function Disclosure({
  open,
  controls,
  onToggle,
  children
}: {
  open: boolean
  controls: string
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? controls : undefined}
        onClick={onToggle}
        className="text-sm font-medium text-[var(--brand-ink)] underline-offset-4 hover:underline"
      >
        {children}
      </button>
    </div>
  )
}

function KlaviyoCard({
  connection,
  owner,
  live
}: {
  connection: ConnectionView | null
  owner: boolean
  live: boolean
}) {
  const [swapping, setSwapping] = useState(false)
  const connected = connection?.status === 'connected'
  // With live Klaviyo on, a sample connection still waits for a real key.
  const sampleOnly = live && connected && connection?.mode !== 'live'
  const showKeyField = owner && (!connected || swapping || sampleOnly)
  // Swapping replaces a key the owner already has; a sample connection
  // waiting for its real key is a first connect.
  const swap = connected && !sampleOnly
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <Tile>
          <Mail className="size-5" />
        </Tile>
        {connected && !live && connection?.templateCount != null && (
          <StatusMark tone="success">
            Pulled {connection.templateCount} sample templates
          </StatusMark>
        )}
      </div>
      <h2 className="text-lg font-semibold">Klaviyo</h2>
      <Benefits
        items={[
          'Unlocks flows & segments',
          'Sync CLTV data',
          'Deliverability insights'
        ]}
      />
      {/* One form for connect and swap, so its result survives the switch
          to the connected state. */}
      <div className="mt-auto">
        {owner ? (
          <ActionForm action={connectKlaviyo} className="space-y-3">
            <NeedsAttention
              connection={connection}
              action="Paste a new private API key to reconnect."
            />
            {connected && !sampleOnly && (
              <ConnectedSummary connection={connection} />
            )}
            {sampleOnly && (
              <p className="text-sm">
                Sample connection. Paste your real key to connect your Klaviyo.
              </p>
            )}
            {connected && !sampleOnly && (
              <Disclosure
                open={swapping}
                controls="klaviyo-key-swap"
                onToggle={() => setSwapping((open) => !open)}
              >
                Update API key
              </Disclosure>
            )}
            {showKeyField && (
              <div id="klaviyo-key-swap" className="space-y-3">
                <Field label={swap ? 'New private API key' : 'Private API key'}>
                  <TextField
                    name="apiKey"
                    placeholder="pk_…"
                    autoFocus={swapping}
                    {...secretProps}
                  />
                </Field>
                <div className="grid [&>button]:w-full">
                  <SubmitButton pendingLabel="Checking…">
                    {swap ? 'Validate & swap key' : 'Connect'}
                  </SubmitButton>
                </div>
                {swap && (
                  // Spec wording says "validated against Klaviyo"; in sample
                  // mode only the format is checked, so say exactly that.
                  <p className="text-xs text-[var(--text-muted)]">
                    The new key is checked before we save. If it fails, your
                    existing key stays in place.
                  </p>
                )}
                <p className="text-xs text-[var(--text-muted)]">
                  {live ? liveNote : sampleNote}
                </p>
              </div>
            )}
          </ActionForm>
        ) : connected ? (
          <div className="space-y-3">
            <ConnectedSummary connection={connection} />
          </div>
        ) : (
          <div className="space-y-3">
            <NeedsAttention
              connection={connection}
              action="Ask your workspace owner to reconnect it."
            />
            <p className="text-sm text-[var(--text-muted)]">
              Not connected. Ask your workspace owner to connect Klaviyo.
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}

function ConnectedSummary({
  connection
}: {
  connection: ConnectionView | null
}) {
  return (
    <>
      <ConnectedBadge label="Klaviyo Connected" />
      <p className="text-center text-xs text-[var(--text-muted)]">
        {[connection?.accountLabel, connection?.credentialHint]
          .filter(Boolean)
          .join(' · ') || 'Sample account'}
      </p>
      <p className="text-center text-xs text-[var(--text-muted)]">
        {connection?.mode === 'live'
          ? 'Live: we only read your Klaviyo data. Nothing is sent to Klaviyo yet.'
          : 'Sample data — nothing is sent to Klaviyo.'}
      </p>
    </>
  )
}

/**
 * The connection cards. v2 is Klaviyo only (BUILD_BRIEF D2): products,
 * images, prices and orders come from Klaviyo, so there is no Shopify card.
 */
export function ConnectionsBoard({
  klaviyo,
  owner,
  live = false
}: {
  klaviyo: ConnectionView | null
  owner: boolean
  /** Klaviyo keys are checked with Klaviyo (KLAVIYO_MODE=live). */
  live?: boolean
}) {
  return (
    <div className="max-w-xl">
      <KlaviyoCard connection={klaviyo} owner={owner} live={live} />
    </div>
  )
}
