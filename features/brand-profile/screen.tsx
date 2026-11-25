import { History, Package, Tag } from 'lucide-react'
import type { ReactNode } from 'react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { ListRow, RowList } from '@/components/gros/list-row'
import { AppPage, CardRow, defaultAssistant } from '@/components/gros/nav'
import { Status } from '@/components/gros/status'
import { ErrorState } from '@/components/gros/states'
import { brandAction } from '@/features/brand/actions'
import { onboardingAction } from '@/features/onboarding/actions'
import { formatBrandDate, formatBrandDateTime } from '@/lib/brand-time'
import { futureIso } from '@/lib/time'
import { redoAllBrandSections } from './actions'
import type { Mismatch } from './mismatch'
import type {
  BrandHistoryEvent,
  BrandPageView,
  BrandVersion,
  CatalogProduct,
  PermittedOffer
} from './page-model'
import { ProfileSections } from './section-cards'
import { sectionKeys } from './sections'

/**
 * Brand (UI-BRAND), a GROS page under Settings at `/settings/brand`: the
 * brand version and the owner's Approve brand (the only way his own words
 * and rules reach the Brand book), the latest Brand book, the six profile
 * sections, the catalog, the permitted offers and the brand's history.
 * Every button calls the existing server action, which checks the owner
 * again; staff read the same page without its buttons.
 */
export const brandHref = '/settings/brand' as const
export const brandBookHref = '/settings/brand/book' as const
/** The Brand version card, where the owner approves his brand. */
export const brandVersionHref = '/settings/brand#version' as const

/** A plain control on the GROS tokens (BRAND.md has no select or text box). */
export const controlClass =
  'type-body w-full rounded-[var(--radius-md)] border-2 border-transparent bg-[var(--mist)] px-[var(--space-4)] text-[var(--ink)] focus:border-[var(--forest)] focus:bg-[var(--white)] focus:outline-none'

function Title({ text, id }: { text: string; id?: string }) {
  return (
    <h2 id={id} className="type-heading">
      {text}
    </h2>
  )
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[var(--space-5)]">{children}</div>
}

/** A row's small picture: a line icon on mist. */
function IconThumb({ icon }: { icon: ReactNode }) {
  return (
    <span
      aria-hidden
      className="gros-thumb flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
    >
      {icon}
    </span>
  )
}

export function BrandScreen({
  view,
  assistant = defaultAssistant
}: {
  view: BrandPageView
  assistant?: string
}) {
  return (
    <AppPage current="settings" title="Brand" assistant={assistant}>
      <div>
        <ButtonLink href="/settings" label="Back to Settings" kind="quiet" />
      </div>
      {view.state === 'error' ? (
        <ErrorState
          title="Brand did not open"
          reason={view.reason}
          action={<ButtonLink href={brandHref} label="Try again" />}
        />
      ) : (
        <>
          <MismatchCard mismatches={view.mismatches} owner={view.owner} />
          <CardRow>
            <ApproveCard
              brand={view.brand}
              owner={view.owner}
              assistant={assistant}
            />
            <BookCard
              book={view.book}
              timezone={view.timezone}
              assistant={assistant}
            />
          </CardRow>
          <ProfileCard
            owner={view.owner}
            lastUpdated={view.lastUpdated}
            revisions={Object.fromEntries(
              view.views.map((v) => [v.section, v.revision])
            )}
            unavailable={view.sectionsUnavailable}
          />
          <ProfileSections
            views={view.views}
            owner={view.owner}
            products={view.products}
            assistant={assistant}
          />
          <CardRow>
            <CatalogCard
              products={view.products}
              owner={view.owner}
              timezone={view.timezone}
            />
            {view.owner ? <AddProductCard /> : null}
          </CardRow>
          <OffersCard
            offers={view.offers}
            owner={view.owner}
            timezone={view.timezone}
          />
          <HistoryCard history={view.history} timezone={view.timezone} />
        </>
      )}
    </AppPage>
  )
}

/** When the profile does not look like the connected Klaviyo or the catalog. */
export function MismatchCard({
  mismatches,
  owner
}: {
  mismatches: Mismatch[]
  owner: boolean
}) {
  if (!mismatches.length) return null
  const title = 'Check your brand'
  return (
    <Card label={title}>
      <div className="flex flex-col items-start gap-[var(--space-4)]">
        <Status kind="needs_you" />
        <Title text={title} />
        <div className="flex flex-col gap-[var(--space-2)]">
          {mismatches.map((m) => (
            <p key={m.message} className="type-body break-words">
              {m.message}
            </p>
          ))}
          <p className="type-body text-[var(--stone)]">
            {owner
              ? 'Fix the brand identity below, or check the Klaviyo account on Settings. If both are right, you can ignore this.'
              : 'Ask the workspace owner to check the brand identity.'}
          </p>
        </div>
        {owner ? (
          <ButtonLink
            href="/settings#klaviyo"
            label="Check Klaviyo"
            kind="outline"
          />
        ) : null}
      </div>
    </Card>
  )
}

/**
 * The brand version and the owner's approval of exactly that version
 * (`approve_brand` with the revision shown: a version changed in another
 * window is refused, never approved blind). Until he approves, drafts and
 * planning wait, and the Brand book leaves his words out.
 */
export function ApproveCard({
  brand,
  owner,
  assistant
}: {
  brand: BrandVersion | null
  owner: boolean
  assistant: string
}) {
  const title = 'Brand version'
  const approved = brand !== null && brand.approvedRevision === brand.revision
  return (
    <div id="version" className="scroll-mt-[var(--space-6)]">
      <Card label={title}>
        <Stack>
          <ActionAnswers>
            <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
              <Title text={title} />
              {brand && !approved && owner ? <Status kind="needs_you" /> : null}
            </div>
            {!brand ? (
              <p className="type-body text-[var(--stone)]">
                No brand yet. Save the brand identity below first.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-[var(--space-1)]">
                  <p className="type-label text-[var(--stone)]">Version</p>
                  <p className="type-number-lg">{brand.revision}</p>
                </div>
                <p className="type-body">
                  {approved
                    ? `Approved for AI use · version ${brand.revision}`
                    : brand.approvedRevision === null
                      ? `Not approved yet. ${assistant} plans and writes only from a version you approve.`
                      : `Your brand details changed since version ${brand.approvedRevision}. Drafts and planning wait until you approve version ${brand.revision}.`}
                </p>
                {owner && !approved ? (
                  <ActionButton
                    action={brandAction}
                    label={`Approve brand v${brand.revision}`}
                    fields={{
                      kind: 'approve',
                      revision: String(brand.revision)
                    }}
                  />
                ) : null}
                {!owner && !approved ? (
                  <p className="type-caption text-[var(--stone)]">
                    Only the workspace owner can approve the brand.
                  </p>
                ) : null}
              </>
            )}
          </ActionAnswers>
        </Stack>
      </Card>
    </div>
  )
}

function BookCard({
  book,
  timezone,
  assistant
}: {
  book: Extract<BrandPageView, { state: 'ready' }>['book']
  timezone: string
  assistant: string
}) {
  const title = 'Brand book'
  if (book === 'unreadable')
    return (
      <Card label={title}>
        <Stack>
          <Title text={title} />
          <p className="type-body text-[var(--signal-ink)]">
            Your Brand book could not be read just now. Nothing was changed.
          </p>
          <div>
            <ButtonLink href={brandHref} label="Try again" />
          </div>
        </Stack>
      </Card>
    )
  return (
    <Card label={title}>
      <Stack>
        <Title text={title} />
        {book ? (
          <>
            <div className="flex flex-col gap-[var(--space-1)]">
              <p className="type-label text-[var(--stone)]">Version</p>
              <p className="type-number-lg">{book.version}</p>
            </div>
            <p className="type-body text-[var(--stone)]">
              What {assistant} knows about your brand, written{' '}
              {formatBrandDate(book.writtenAt, timezone)}.
            </p>
          </>
        ) : (
          <p className="type-body text-[var(--stone)]">
            Not written yet. {assistant} writes it after reading your store.
          </p>
        )}
        <div>
          <ButtonLink
            href={brandBookHref}
            label="Review Brand book"
            kind="outline"
          />
        </div>
      </Stack>
    </Card>
  )
}

function ProfileCard({
  owner,
  lastUpdated,
  revisions,
  unavailable
}: {
  owner: boolean
  lastUpdated: string | null
  /** Current revision per section, for Redo all with AI. */
  revisions: Record<string, number>
  unavailable: boolean
}) {
  const title = 'Profile'
  return (
    <Card size="small" label={title}>
      <Stack>
        <Title text={title} />
        <p className="type-body text-[var(--stone)]">
          {lastUpdated ? `Last updated ${lastUpdated}` : 'Not filled in yet'}
        </p>
        {unavailable ? (
          <p className="type-body text-[var(--signal-ink)]">
            The sections below could not be read just now. Your saved brand
            details and approvals still work.
          </p>
        ) : null}
        {owner ? (
          <div className="flex flex-col gap-[var(--space-2)]">
            <ActionButton
              action={redoAllBrandSections}
              label="Redo all with AI"
              kind="outline"
              fields={Object.fromEntries(
                sectionKeys.map((key) => [
                  `revision:${key}`,
                  String(revisions[key] ?? 0)
                ])
              )}
            />
            <p className="type-caption text-[var(--stone)]">
              Sample writer: fills empty fields only.
            </p>
          </div>
        ) : null}
      </Stack>
    </Card>
  )
}

const productSource: Record<string, string> = {
  manual: 'Added by you',
  fixture: 'Sample catalog',
  klaviyo: 'From Klaviyo'
}

function CatalogCard({
  products,
  owner,
  timezone
}: {
  products: CatalogProduct[]
  owner: boolean
  timezone: string
}) {
  const title = 'Catalog'
  return (
    <Card label={title}>
      <Stack>
        <ActionAnswers>
          <Title text={title} id="catalog" />
          {products.length === 0 ? (
            <p className="type-body text-[var(--stone)]">No products yet.</p>
          ) : (
            <RowList label="Products">
              {products.map((p) => (
                <ListRow
                  key={p.id}
                  wrap
                  thumbnail={<IconThumb icon={<Package size={18} />} />}
                  title={p.title}
                  details={[
                    `${p.stock} available`,
                    p.synthetic
                      ? 'Sample'
                      : (productSource[p.source] ?? p.source),
                    `Stock checked ${formatBrandDateTime(p.stockCheckedAt, timezone) ?? 'unknown'}`
                  ]}
                  end={null}
                />
              ))}
            </RowList>
          )}
          {owner && products.length ? (
            <ActionButton
              action={onboardingAction}
              label="Save stock"
              kind="outline"
              fields={{ kind: 'stock' }}
            >
              <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
                <div className="flex flex-col gap-[var(--space-2)]">
                  <label
                    htmlFor="stock-product"
                    className="gros-field-label text-[var(--ink)]"
                  >
                    Product
                  </label>
                  <select
                    id="stock-product"
                    name="product"
                    className={`${controlClass} min-h-[var(--control-lg)]`}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
                <Field
                  label="Verified stock"
                  name="stock"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  required
                />
              </div>
            </ActionButton>
          ) : null}
        </ActionAnswers>
      </Stack>
    </Card>
  )
}

function AddProductCard() {
  const title = 'Add a product'
  return (
    <Card label={title}>
      <Stack>
        <Title text={title} />
        <ActionButton
          action={brandAction}
          label="Add product"
          fields={{ kind: 'product' }}
        >
          <Field label="Product title" name="title" required maxLength={200} />
          <Field label="Product web address" name="url" type="url" required />
          <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
            <Field
              label="Price in the smallest unit of your currency"
              name="price_minor"
              type="number"
              min={0}
              defaultValue={0}
            />
            <Field
              label="Verified stock"
              name="stock"
              type="number"
              min={0}
              defaultValue={0}
            />
          </div>
        </ActionButton>
      </Stack>
    </Card>
  )
}

const offerKinds: Record<string, string> = {
  evergreen: 'Always on',
  discount: 'Discount',
  sitewide: 'Sitewide offer'
}

function OffersCard({
  offers,
  owner,
  timezone
}: {
  offers: PermittedOffer[]
  owner: boolean
  timezone: string
}) {
  const title = 'Permitted offers'
  return (
    <Card label={title}>
      <Stack>
        <Title text={title} />
        {offers.length === 0 ? (
          <p className="type-body text-[var(--stone)]">No offers saved.</p>
        ) : (
          <RowList label={title}>
            {offers.map((o) => (
              <ListRow
                key={o.id}
                wrap
                thumbnail={<IconThumb icon={<Tag size={18} />} />}
                title={o.label}
                details={[
                  offerKinds[o.kind] ?? o.kind,
                  o.depthPercent ? `Up to ${o.depthPercent}% off` : '',
                  `Until ${formatBrandDate(o.endsAt, timezone) ?? 'unknown'}`,
                  o.conditions
                ]}
                end={null}
              />
            ))}
          </RowList>
        )}
        {owner ? (
          <ActionButton
            action={brandAction}
            label="Save offer"
            fields={{ kind: 'offer' }}
          >
            <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
              <Field label="Offer name" name="label" required maxLength={200} />
              <div className="flex flex-col gap-[var(--space-2)]">
                <label
                  htmlFor="offer-kind"
                  className="gros-field-label text-[var(--ink)]"
                >
                  Offer type
                </label>
                <select
                  id="offer-kind"
                  name="offer_kind"
                  className={`${controlClass} min-h-[var(--control-lg)]`}
                >
                  {Object.entries(offerKinds).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <Field
                label="Biggest discount in percent"
                name="depth_percent"
                type="number"
                min={0}
                max={100}
                defaultValue={0}
              />
              <Field
                label="Starts (UTC)"
                name="starts_at"
                defaultValue={new Date().toISOString()}
                required
              />
              <Field
                label="Ends (UTC)"
                name="ends_at"
                defaultValue={futureIso(30)}
                required
              />
            </div>
            <div className="flex flex-col gap-[var(--space-2)]">
              <label
                htmlFor="offer-conditions"
                className="gros-field-label text-[var(--ink)]"
              >
                Offer conditions
              </label>
              <textarea
                id="offer-conditions"
                name="conditions"
                required
                rows={2}
                maxLength={2000}
                className={`${controlClass} py-[var(--space-3)]`}
              />
            </div>
          </ActionButton>
        ) : null}
      </Stack>
    </Card>
  )
}

const eventWords: Record<string, string> = {
  owner_approved: 'Approved by the owner',
  facts_corrected: 'Brand details changed'
}

function HistoryCard({
  history,
  timezone
}: {
  history: BrandHistoryEvent[] | null
  timezone: string
}) {
  const title = 'Brand history'
  return (
    <Card label={title}>
      <Stack>
        <Title text={title} />
        {history === null ? (
          <p className="type-body text-[var(--stone)]">
            The history could not be read just now. Open this page again in a
            minute.
          </p>
        ) : history.length === 0 ? (
          <p className="type-body text-[var(--stone)]">No changes yet.</p>
        ) : (
          <RowList label={title}>
            {history.map((e) => (
              <ListRow
                key={e.id}
                thumbnail={<IconThumb icon={<History size={18} />} />}
                title={`Version ${e.revision}`}
                details={[
                  eventWords[e.action] ?? e.action.replaceAll('_', ' '),
                  formatBrandDateTime(e.at, timezone) ?? ''
                ]}
                end={null}
              />
            ))}
          </RowList>
        )}
      </Stack>
    </Card>
  )
}
