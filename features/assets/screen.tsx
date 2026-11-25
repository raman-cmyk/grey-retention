import Image from 'next/image'
import Link from 'next/link'
import { Cog, FileImage, ListChecks } from 'lucide-react'
import type { ReactNode } from 'react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink, buttonClasses } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { ListRow, RowList } from '@/components/gros/list-row'
import { AppPage, CardRow, defaultAssistant } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'
import { importAssets } from '@/features/assets/actions'
import { onboardingAction } from '@/features/onboarding/actions'
import { cn } from '@/lib/utils'
import {
  assetCategories,
  assetFilters,
  filterWords,
  connectionLine,
  connectionStatuses,
  connectionStatusWord,
  jobWords,
  type AssetTile,
  type AssetsView
} from './view'

/**
 * Brand assets (UI-BRAND), a GROS page under Brand at
 * `/brand/assets` (UI-BRAND-2): upload the brand's own images (private originals,
 * no product photo is ever generated), the files with their sorting and
 * the owner's corrections, the recent uploads, the brand kit and, for the
 * owner only, the sample data tools (test controls that never contact
 * Klaviyo or Google Drive). Every button calls the existing server action
 * (`importAssets`, `onboardingAction`), which checks again.
 */
export const assetsHref = '/brand/assets' as const

const control =
  'type-body w-full rounded-[var(--radius-md)] border-2 border-transparent bg-[var(--mist)] px-[var(--space-4)] text-[var(--ink)] focus:border-[var(--forest)] focus:bg-[var(--white)] focus:outline-none'

function Title({ text }: { text: string }) {
  return <h2 className="type-heading">{text}</h2>
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[var(--space-5)]">{children}</div>
}

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

function Select({
  id,
  label,
  name,
  defaultValue,
  children
}: {
  id: string
  label: string
  name: string
  defaultValue?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <label htmlFor={id} className="gros-field-label text-[var(--ink)]">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        className={`${control} min-h-[var(--control-lg)]`}
      >
        {children}
      </select>
    </div>
  )
}

export function AssetsScreen({
  view,
  assistant = defaultAssistant
}: {
  view: AssetsView
  assistant?: string
}) {
  return (
    <AppPage current="brand" title="Brand assets" assistant={assistant}>
      <div>
        <ButtonLink href="/brand" label="Back to Brand" kind="quiet" />
      </div>
      {view.state === 'error' ? (
        <ErrorState
          title="Brand assets did not open"
          reason={view.reason}
          action={<ButtonLink href={assetsHref} label="Try again" />}
        />
      ) : (
        <>
          <CardRow>
            <UploadCard />
            <KitCard view={view} />
          </CardRow>
          <FilesCard view={view} />
          <UploadsCard view={view} />
          {view.owner ? <SampleTools view={view} /> : null}
        </>
      )}
    </AppPage>
  )
}

type Ready = Extract<AssetsView, { state: 'ready' }>

function UploadCard() {
  const title = 'Upload files'
  return (
    <Card label={title}>
      <Stack>
        <Title text={title} />
        <ActionButton action={importAssets} label="Import private assets">
          <div className="flex flex-col gap-[var(--space-2)]">
            <label
              htmlFor="asset-files"
              className="gros-field-label text-[var(--ink)]"
            >
              Brand image files or one ZIP
            </label>
            <input
              id="asset-files"
              name="files"
              type="file"
              multiple
              required
              accept="image/png,image/jpeg,image/webp,.zip"
              aria-describedby="asset-files-help"
              className={`${control} py-[var(--space-3)]`}
            />
            <p
              id="asset-files-help"
              className="type-caption text-[var(--stone)]"
            >
              PNG, JPEG or WebP, up to 100 files: 10 MB to upload, 20 MB
              unpacked. Each file is checked on its own and kept private.
            </p>
          </div>
        </ActionButton>
      </Stack>
    </Card>
  )
}

function KitCard({ view }: { view: Ready }) {
  const title = 'Brand kit'
  const kit = view.kit
  return (
    <Card label={title}>
      <Stack>
        <ActionAnswers>
          <Title text={title} />
          {!kit ? (
            <p className="type-body text-[var(--stone)]">
              No colors or fonts yet.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-[var(--space-2)]">
                <p className="type-label text-[var(--stone)]">Colors</p>
                {kit.colors.length ? (
                  <ul
                    aria-label="Kit colors"
                    className="flex flex-wrap gap-[var(--space-3)]"
                  >
                    {kit.colors.map((color) => (
                      <li
                        key={color}
                        className="type-caption flex items-center gap-[var(--space-2)]"
                      >
                        <span
                          aria-hidden
                          className="size-[var(--control-sm)] rounded-[var(--radius-sm)] border border-[var(--line)]"
                          style={{ backgroundColor: color }}
                        />
                        {color}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="type-body text-[var(--stone)]">None given</p>
                )}
              </div>
              <div className="flex flex-col gap-[var(--space-1)]">
                <p className="type-label text-[var(--stone)]">Fonts</p>
                <p className="type-body">
                  {kit.fonts.join(', ') || 'None given'}
                </p>
              </div>
              <p className="type-caption text-[var(--stone)]">
                Version {kit.revision} · Read from sample text ·{' '}
                {kit.approved_by
                  ? 'Owner approved this kit version.'
                  : 'Not approved yet'}
              </p>
              {view.owner && !kit.approved_by ? (
                <ActionButton
                  action={onboardingAction}
                  label={`Approve kit v${kit.revision}`}
                  fields={{
                    kind: 'kit_approve',
                    revision: String(kit.revision)
                  }}
                />
              ) : null}
            </>
          )}
        </ActionAnswers>
      </Stack>
    </Card>
  )
}

function FilesCard({ view }: { view: Ready }) {
  const title = 'Your files'
  return (
    <Card label={title}>
      <Stack>
        <Title text={title} />
        <p className="type-caption text-[var(--stone)]">
          Sorting and catalog matches come from a sample sorter: check them
          before a design uses them. Unclear matches stay unmatched.
        </p>
        <nav aria-label="Filter files">
          <ul className="flex flex-wrap gap-[var(--space-2)]">
            {assetFilters.map((filter) => (
              <li key={filter}>
                <Link
                  href={`${assetsHref}?category=${filter}`}
                  aria-current={view.filter === filter ? 'page' : undefined}
                  className={cn(
                    buttonClasses(
                      view.filter === filter ? 'lime' : 'outline',
                      'row'
                    )
                  )}
                >
                  {filterWords[filter]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="type-body text-[var(--stone)]">
          {view.tiles.length} of {view.total}{' '}
          {view.total === 1 ? 'file' : 'files'} shown
        </p>
        {view.tiles.length === 0 ? (
          <p className="type-body text-[var(--stone)]">
            No files here. Upload your own, or use the sample tools below.
          </p>
        ) : (
          <div className="grid gap-[var(--space-5)] sm:grid-cols-2 lg:grid-cols-3">
            {view.tiles.map((tile) => (
              <AssetCard key={tile.id} tile={tile} view={view} />
            ))}
          </div>
        )}
      </Stack>
    </Card>
  )
}

function AssetCard({ tile, view }: { tile: AssetTile; view: Ready }) {
  return (
    <article className="flex min-w-0 flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--mist)] p-[var(--space-4)]">
      <div className="flex h-44 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--white)]">
        {tile.preview ? (
          <Image
            src={tile.preview}
            width={300}
            height={180}
            unoptimized
            alt={tile.filename}
            className="h-full w-full object-contain"
          />
        ) : (
          <p className="type-caption text-[var(--stone)]">
            Preview unavailable
          </p>
        )}
      </div>
      <h3 className="type-body-strong break-words">{tile.filename}</h3>
      <p className="type-caption text-[var(--stone)]">{tile.details}</p>
      <p className="type-caption text-[var(--stone)]">{tile.match}</p>
      {view.owner ? (
        <details className="flex flex-col gap-[var(--space-3)]">
          <summary
            aria-label={`Review classification for ${tile.filename}`}
            className={cn(buttonClasses('quiet'), 'list-none')}
          >
            Review
          </summary>
          <ActionButton
            key={tile.revision}
            action={onboardingAction}
            label="Save owner correction"
            kind="outline"
            size="row"
            spokenLabel={tile.filename}
            fields={{
              kind: 'correct',
              asset: tile.id,
              revision: String(tile.revision)
            }}
          >
            <Select
              id={`category-${tile.id}`}
              label={`Category for ${tile.filename}`}
              name="category"
              defaultValue={tile.category ?? 'unusable'}
            >
              {assetCategories.map((c) => (
                <option key={c} value={c}>
                  {filterWords[c]}
                </option>
              ))}
            </Select>
            <Select
              id={`product-${tile.id}`}
              label={`Product for ${tile.filename}`}
              name="product"
              defaultValue={tile.productId ?? ''}
            >
              <option value="">No product</option>
              {view.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
            <Select
              id={`variant-${tile.id}`}
              label={`Variant for ${tile.filename}`}
              name="variant"
              defaultValue={tile.variantId ?? ''}
            >
              <option value="">No variant</option>
              {view.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </ActionButton>
        </details>
      ) : null}
    </article>
  )
}

function UploadsCard({ view }: { view: Ready }) {
  const title = 'Recent uploads'
  return (
    <Card label={title}>
      <Stack>
        <Title text={title} />
        {view.uploads.length === 0 ? (
          <p className="type-body text-[var(--stone)]">No uploads yet.</p>
        ) : (
          <RowList label={title}>
            {view.uploads.map((u) => (
              <ListRow
                key={u.id}
                wrap
                thumbnail={<IconThumb icon={<FileImage size={18} />} />}
                title={u.filename}
                details={[u.outcome, u.diagnostic ?? '']}
                end={null}
              />
            ))}
          </RowList>
        )}
        <p className="type-caption text-[var(--stone)]">{view.importsLine}</p>
      </Stack>
    </Card>
  )
}

/**
 * Names in the sample tools. The product fixture still uses the old
 * `shopify` provider row internally (its job needs it), but v2 is Klaviyo
 * only (BUILD_BRIEF D2), so the screen calls it the sample catalog.
 */
const fixtureName = {
  klaviyo: 'klaviyo',
  shopify: 'sample catalog',
  drive: 'drive'
} as const
/** Each sample connection's card title. */
const fixtureTitle = {
  klaviyo: 'Sample Klaviyo',
  shopify: 'Sample catalog',
  drive: 'Sample Drive folder'
} as const

/**
 * The sample data tools, for the owner only (the actions refuse anyone
 * else): the setup jobs, readiness, sample sorting and the sample
 * connections. With live Klaviyo on there is no sample Klaviyo tool, and
 * the action refuses a Klaviyo sample status (KLV-001).
 */
function SampleTools({ view }: { view: Ready }) {
  const providers = view.liveKlaviyo
    ? (['shopify', 'drive'] as const)
    : (['klaviyo', 'shopify', 'drive'] as const)
  return (
    <>
      <CardRow>
        <Card label="Setup jobs">
          <Stack>
            <ActionAnswers>
              <Title text="Setup jobs" />
              <p className="type-caption text-[var(--stone)]">
                Sample data tools. They never contact Klaviyo or Google Drive.
              </p>
              {view.jobs.length === 0 ? (
                <p className="type-body text-[var(--stone)]">
                  No setup jobs yet.
                </p>
              ) : (
                <RowList label="Setup jobs">
                  {view.jobs.map((job) => {
                    const words = jobWords(job)
                    return (
                      <ListRow
                        key={job.id}
                        thumbnail={<IconThumb icon={<Cog size={18} />} />}
                        title={words.title}
                        details={words.details}
                        end={null}
                      />
                    )
                  })}
                </RowList>
              )}
              <ActionButton
                action={onboardingAction}
                label="Run queued setup jobs"
                fields={{ kind: 'run' }}
              />
              <ActionButton
                action={onboardingAction}
                label="Queue synthetic classification"
                kind="outline"
                fields={{
                  kind: 'queue',
                  job: 'assets.classify',
                  sourceText: ''
                }}
              />
            </ActionAnswers>
          </Stack>
        </Card>
      </CardRow>
      <CardRow>
        <Card label="Sample kit reader">
          <Stack>
            <ActionAnswers>
              <Title text="Sample kit reader" />
              <ActionButton
                action={onboardingAction}
                label="Queue fixture kit extraction"
                fields={{ kind: 'queue', job: 'brand.extract' }}
              >
                <div className="flex flex-col gap-[var(--space-2)]">
                  <label
                    htmlFor="kit-text"
                    className="gros-field-label text-[var(--ink)]"
                  >
                    Brand kit source text
                  </label>
                  <textarea
                    id="kit-text"
                    name="sourceText"
                    rows={3}
                    required
                    maxLength={10000}
                    aria-describedby="kit-text-help"
                    className={`${control} py-[var(--space-3)]`}
                  />
                  <p
                    id="kit-text-help"
                    className="type-caption text-[var(--stone)]"
                  >
                    Sample reader: finds six-digit colors like #18302C and
                    “font: Name”. It reads nothing else.
                  </p>
                </div>
              </ActionButton>
            </ActionAnswers>
          </Stack>
        </Card>
        <Card label="Readiness">
          <Stack>
            <Title text="Readiness" />
            <p className="type-caption text-[var(--stone)]">
              Sample evidence only: sorting and connections are simulated.
            </p>
            <RowList label="Readiness">
              {view.readiness.gates.map((gate) => (
                <ListRow
                  key={gate.name}
                  wrap
                  thumbnail={<IconThumb icon={<ListChecks size={18} />} />}
                  title={gate.name}
                  details={[gate.met ? 'Done' : 'To do', gate.detail]}
                  end={null}
                />
              ))}
            </RowList>
          </Stack>
        </Card>
      </CardRow>
      <CardRow columns={3}>
        {providers.map((provider) => {
          const c = view.connections.find((c) => c.provider === provider)
          const name = fixtureName[provider]
          const title = fixtureTitle[provider]
          return (
            <Card key={provider} size="small" label={title}>
              <Stack>
                <ActionAnswers>
                  <Title text={title} />
                  <p className="type-caption break-words text-[var(--stone)]">
                    {connectionLine(c)}
                  </p>
                  <ActionButton
                    key={c?.revision ?? 0}
                    action={onboardingAction}
                    label={`Save ${name} fixture`}
                    kind="outline"
                    fields={{
                      kind: 'connection',
                      provider,
                      ...(provider === 'drive' ? {} : { folder: '' })
                    }}
                  >
                    <Select
                      id={`fixture-${provider}`}
                      label={`${name} fixture status`}
                      name="status"
                      defaultValue={c?.status ?? 'connected'}
                    >
                      {connectionStatuses.map((s) => (
                        <option key={s} value={s}>
                          {connectionStatusWord(s)}
                        </option>
                      ))}
                    </Select>
                    {provider === 'drive' ? (
                      <Field
                        label="Read-only fixture folder"
                        name="folder"
                        defaultValue={c?.folder_id ?? 'fixture:brand-assets'}
                        required
                      />
                    ) : null}
                  </ActionButton>
                  {provider !== 'klaviyo' && c?.status === 'connected' ? (
                    <ActionButton
                      action={onboardingAction}
                      label={`Queue ${name} sync`}
                      kind="outline"
                      fields={{
                        kind: 'queue',
                        job:
                          provider === 'drive' ? 'drive.sync' : 'commerce.sync',
                        sourceText: ''
                      }}
                    />
                  ) : null}
                </ActionAnswers>
              </Stack>
            </Card>
          )
        })}
      </CardRow>
    </>
  )
}
