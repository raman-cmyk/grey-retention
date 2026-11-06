'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Check,
  CircleHelp,
  Link2,
  Mail,
  Plus,
  ShoppingBag,
  TriangleAlert
} from 'lucide-react'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { Button } from '@/components/ui/button'
import { StatusMark } from '@/components/ui/status-mark'
import { TextField } from '@/components/ui/text-field'
import { Field } from '@/components/ui/workspace'
import { connectKlaviyo, connectShopify } from './actions'

/** What the screen needs from one `workspace_connections` row. */
export type ConnectionView = {
  status: string
  accountLabel: string | null
  credentialHint: string | null
  shopDomain: string | null
  templateCount: number | null
}

const sampleNote =
  'Sample mode: we check the format only. Nothing is sent to the provider, and the full key is never saved — only the masked hint.'
const labelClass =
  'tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'
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
  owner
}: {
  connection: ConnectionView | null
  owner: boolean
}) {
  const [swapping, setSwapping] = useState(false)
  const connected = connection?.status === 'connected'
  const showKeyField = owner && (!connected || swapping)
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <Tile>
          <Mail className="size-5" />
        </Tile>
        {connected && connection?.templateCount != null && (
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
            {connected && <ConnectedSummary connection={connection} />}
            {connected && (
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
                <Field
                  label={connected ? 'New private API key' : 'Private API key'}
                >
                  <TextField
                    name="apiKey"
                    placeholder="pk_…"
                    autoFocus={connected}
                    {...secretProps}
                  />
                </Field>
                <div className="grid [&>button]:w-full">
                  <SubmitButton pendingLabel="Checking…">
                    {connected ? 'Validate & swap key' : 'Connect'}
                  </SubmitButton>
                </div>
                {connected && (
                  // Spec wording says "validated against Klaviyo"; in sample
                  // mode only the format is checked, so say exactly that.
                  <p className="text-xs text-[var(--text-muted)]">
                    The new key is checked before we save. If it fails, your
                    existing key stays in place.
                  </p>
                )}
                <p className="text-xs text-[var(--text-muted)]">{sampleNote}</p>
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
        Sample data — nothing is sent to Klaviyo.
      </p>
    </>
  )
}

function ShopifyCard({
  connection,
  owner,
  open,
  onToggle
}: {
  connection: ConnectionView | null
  owner: boolean
  open: boolean
  onToggle: () => void
}) {
  const connected = connection?.status === 'connected'
  return (
    <Card>
      <Tile>
        <ShoppingBag className="size-5" />
      </Tile>
      <h2 className="text-lg font-semibold">Shopify</h2>
      <Benefits
        items={[
          'Products & inventory',
          'Orders & customers',
          'Discount-code creation'
        ]}
      />
      <div className="mt-auto space-y-3">
        <NeedsAttention
          connection={connection}
          action={
            owner
              ? 'Connect the store again with a new access token.'
              : 'Ask your workspace owner to reconnect it.'
          }
        />
        {connected && (
          <>
            <ConnectedBadge label="Shopify Connected" />
            <p className="text-center text-xs text-[var(--text-muted)]">
              {[
                connection?.shopDomain ?? connection?.accountLabel,
                connection?.credentialHint
              ]
                .filter(Boolean)
                .join(' · ') || 'Sample store'}
            </p>
            <p className="text-center text-xs text-[var(--text-muted)]">
              Sample products — nothing is sent to Shopify.
            </p>
          </>
        )}
        {!connected && (
          // Owner brief §13: say what is missing without Shopify.
          <p className="text-xs text-[var(--warning-ink)]">
            Without Shopify: no Store page, no UTM revenue, product list may be
            outdated.
          </p>
        )}
        {owner &&
          (connected ? (
            <Disclosure
              open={open}
              controls="connect-shopify"
              onToggle={onToggle}
            >
              Update access token
            </Disclosure>
          ) : (
            <div className="grid [&>button]:w-full">
              <Button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                aria-controls={open ? 'connect-shopify' : undefined}
              >
                Connect Shopify
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        {!owner && !connected && (
          <p className="text-sm text-[var(--text-muted)]">
            Not connected. Ask your workspace owner to connect Shopify.
          </p>
        )}
      </div>
    </Card>
  )
}

const scopes = [
  'read_products',
  'read_orders',
  'read_customers',
  'read_analytics'
]

function ShopifyForm({ domain }: { domain: string | null }) {
  const [shop, setShop] = useState(domain ?? '')
  const email = shop.includes('@')
  return (
    <section
      id="connect-shopify"
      aria-labelledby="connect-shopify-title"
      className="space-y-5 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6"
    >
      <div className="space-y-2">
        <h2 id="connect-shopify-title" className="text-lg font-semibold">
          Connect your Shopify store
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Create a Custom App in your Shopify admin, give it read access to{' '}
          <strong className="text-[var(--text)]">
            products, orders, customers, and analytics
          </strong>
          , then paste the Admin API access token here.{' '}
          <a
            href="https://help.shopify.com/en/manual/apps/app-types/custom-apps"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--brand-ink)] underline-offset-4 hover:underline"
          >
            How to create a Custom App →
          </a>
        </p>
      </div>
      {/* The token field is uncontrolled, so it is cleared after each
          submit; the domain is kept. */}
      <ActionForm action={connectShopify} className="space-y-5">
        <div className="space-y-2">
          <Field label="Shop domain">
            {/* Old-app bug: browsers autofilled an email address here. */}
            <TextField
              name="shopDomain"
              value={shop}
              onChange={(event) => setShop(event.target.value)}
              placeholder="your-store.myshopify.com"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="url"
              required
              autoFocus
              data-1p-ignore
              data-lpignore="true"
              aria-describedby="shop-domain-help"
              aria-invalid={email ? true : undefined}
            />
          </Field>
          <p id="shop-domain-help" className="text-xs text-[var(--text-muted)]">
            {email ? (
              <span className="text-[var(--danger-ink)]">
                That looks like an email address. Use your store’s
                .myshopify.com address.
              </span>
            ) : (
              <>
                The <code>.myshopify.com</code> address, not your custom domain.
              </>
            )}
          </p>
        </div>
        <div className="space-y-2">
          <Field label="Admin API access token">
            <TextField
              name="accessToken"
              placeholder="shpat_…"
              aria-describedby="shop-token-help"
              {...secretProps}
            />
          </Field>
          <p id="shop-token-help" className="text-xs text-[var(--text-muted)]">
            Starts with <code>shpat_</code> or <code>shpca_</code>. In your
            Custom App:{' '}
            <strong className="text-[var(--text)]">
              Configuration → Install app → API credentials tab → “Admin API
              access token” section → Reveal token once
            </strong>
            .
          </p>
        </div>
        <p className="flex gap-2 text-xs text-[var(--warning-ink)]">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            Not the same as the API secret key (<code>shpss_…</code>) or the API
            key. The access token is shown only ONCE — if you missed it,
            uninstall and reinstall the app to regenerate.
          </span>
        </p>
        <div className="rounded-[var(--radius-control)] bg-[var(--surface-hover)] p-3 text-xs">
          <p className="mb-2 font-medium">Required scopes:</p>
          <ul className="flex flex-wrap gap-2">
            {scopes.map((scope) => (
              <li
                key={scope}
                className="rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-2 py-0.5 font-mono"
              >
                {scope}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-[var(--text-muted)]">{sampleNote}</p>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Checking…">
            <Link2 className="size-4" aria-hidden="true" />
            Verify & connect
          </SubmitButton>
        </div>
      </ActionForm>
      <details className="border-t border-[var(--line)] pt-4 text-sm">
        <summary
          className={`flex cursor-pointer items-center gap-2 ${labelClass}`}
        >
          <CircleHelp className="size-4" aria-hidden="true" />
          Common issues
        </summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[var(--text-muted)]">
          <li>
            “That looks like an email address”: your browser filled in your
            email. Type the store address, for example your-store.myshopify.com.
          </li>
          <li>
            “Use the .myshopify.com address”: your custom domain (like
            yourstore.com) will not work. Find the .myshopify.com address in
            Shopify under Settings → Domains.
          </li>
          <li>
            “That is the API secret key”: copy the Admin API access token
            (shpat_…), not the API key or the API secret key (shpss_…).
          </li>
          <li>
            Lost the token: Shopify shows it only once. Uninstall and reinstall
            the Custom App to get a new one.
          </li>
        </ul>
      </details>
    </section>
  )
}

/** The two connection cards; the Shopify form opens full width below them. */
export function ConnectionsBoard({
  klaviyo,
  shopify,
  owner
}: {
  klaviyo: ConnectionView | null
  shopify: ConnectionView | null
  owner: boolean
}) {
  const [shopifyOpen, setShopifyOpen] = useState(false)
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <KlaviyoCard connection={klaviyo} owner={owner} />
        <ShopifyCard
          connection={shopify}
          owner={owner}
          open={shopifyOpen}
          onToggle={() => setShopifyOpen((open) => !open)}
        />
      </div>
      {owner && shopifyOpen && (
        <ShopifyForm domain={shopify?.shopDomain ?? null} />
      )}
    </div>
  )
}
