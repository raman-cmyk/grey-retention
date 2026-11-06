'use client'
import { useState, type ReactNode } from 'react'
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
import { TextField } from '@/components/ui/text-field'
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

function FieldLabel({
  htmlFor,
  children
}: {
  htmlFor: string
  children: ReactNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[11px] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase"
    >
      {children}
    </label>
  )
}

/** Looks like the accent button, but is a status, not an action. */
function ConnectedBadge({ label }: { label: string }) {
  return (
    <p
      role="status"
      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--brand-secondary)] px-4 text-sm font-medium text-[var(--on-brand-secondary)]"
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
    <p role="alert" className="flex gap-2 text-sm text-[var(--danger-ink)]">
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

function KlaviyoCard({
  connection,
  owner
}: {
  connection: ConnectionView | null
  owner: boolean
}) {
  const [swapping, setSwapping] = useState(false)
  const connected = connection?.status === 'connected'
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <Tile>
          <Mail className="size-5" />
        </Tile>
        {connected && connection?.templateCount != null && (
          <span className="bg-success-faint text-success inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] uppercase">
            <Check className="size-3.5" aria-hidden="true" />
            Pulled {connection.templateCount} templates
          </span>
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
      <div className="mt-auto space-y-3">
        <NeedsAttention
          connection={connection}
          action={
            owner
              ? 'Paste a new private API key to reconnect.'
              : 'Ask your workspace owner to reconnect it.'
          }
        />
        {connected ? (
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
            {owner && !swapping && (
              <button
                type="button"
                className="mx-auto block text-sm font-medium text-[var(--brand-ink)] underline-offset-4 hover:underline"
                onClick={() => setSwapping(true)}
              >
                Update API key
              </button>
            )}
            {owner && swapping && (
              <KeyForm
                label="New private API key"
                submit="Validate & swap key"
                // Spec wording says "validated against Klaviyo"; in sample mode only the
                // format is checked, so say exactly that until live verification exists.
                caption="The new key is checked before we save. If it fails, your existing key stays in place."
              />
            )}
          </>
        ) : owner ? (
          <KeyForm label="Private API key" submit="Connect" />
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            Not connected. Ask your workspace owner to connect Klaviyo.
          </p>
        )}
      </div>
    </Card>
  )
}

function KeyForm({
  label,
  submit,
  caption
}: {
  label: string
  submit: string
  caption?: string
}) {
  return (
    <ActionForm action={connectKlaviyo} className="space-y-3">
      <div className="space-y-2">
        <FieldLabel htmlFor="klaviyo-key">{label}</FieldLabel>
        <TextField
          id="klaviyo-key"
          name="apiKey"
          type="password"
          placeholder="pk_…"
          autoComplete="off"
          spellCheck={false}
          required
          data-1p-ignore
          data-lpignore="true"
        />
      </div>
      <div className="grid [&>button]:w-full">
        <SubmitButton variant="primary">{submit}</SubmitButton>
      </div>
      {caption && <p className="text-xs text-[var(--text-muted)]">{caption}</p>}
      <p className="text-xs text-[var(--text-muted)]">{sampleNote}</p>
    </ActionForm>
  )
}

function ShopifyCard({
  connection,
  owner,
  open,
  onOpen
}: {
  connection: ConnectionView | null
  owner: boolean
  open: boolean
  onOpen: () => void
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
        {owner && !open && (
          <Button
            type="button"
            variant={connected ? 'quiet' : 'primary'}
            className={connected ? 'mx-auto' : 'w-full self-stretch'}
            onClick={onOpen}
            aria-expanded={false}
            aria-controls="connect-shopify"
          >
            {connected ? 'Update access token' : 'Connect Shopify'}
            {!connected && <ArrowRight className="size-4" aria-hidden="true" />}
          </Button>
        )}
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
      <ActionForm action={connectShopify} className="space-y-5" preserveValues>
        <div className="space-y-2">
          <FieldLabel htmlFor="shop-domain">Shop domain</FieldLabel>
          {/* Old-app bug: browsers autofilled an email address here. */}
          <TextField
            id="shop-domain"
            name="shopDomain"
            value={shop}
            onChange={(event) => setShop(event.target.value)}
            placeholder="your-store.myshopify.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            required
            data-1p-ignore
            data-lpignore="true"
            aria-describedby="shop-domain-help"
            aria-invalid={shop.includes('@') ? true : undefined}
          />
          <p id="shop-domain-help" className="text-xs text-[var(--text-muted)]">
            {shop.includes('@') ? (
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
          <FieldLabel htmlFor="shop-token">Admin API access token</FieldLabel>
          <TextField
            id="shop-token"
            name="accessToken"
            type="password"
            placeholder="shpat_…"
            autoComplete="off"
            spellCheck={false}
            required
            data-1p-ignore
            data-lpignore="true"
            aria-describedby="shop-token-help"
          />
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
          <SubmitButton>
            <Link2 className="size-4" aria-hidden="true" />
            Verify & connect
          </SubmitButton>
        </div>
      </ActionForm>
      <details className="border-t border-[var(--line)] pt-4 text-sm">
        <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
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
          onOpen={() => setShopifyOpen(true)}
        />
      </div>
      {owner && shopifyOpen && (
        <ShopifyForm domain={shopify?.shopDomain ?? null} />
      )}
    </div>
  )
}
