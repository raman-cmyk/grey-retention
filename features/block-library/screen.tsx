import type { Route } from 'next'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { AppPage, CardRow } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { toSafePreview } from '@/features/email-generation/to-safe-preview'
import { setLayoutHidden } from './actions'
import { kindWords } from './count'
import type { LibraryView, ShownBlock } from './screen-read'

/**
 * DES-ENGINE-004b: the block library (Inspiration → Block library). The
 * layouts GROS builds Scratch emails from, by kind, each drawn in the
 * brand's own look (never another brand's words or pictures), with how
 * often the layout is used; the workspace's own blocks (from its own
 * emails) are marked "Yours". Read-only, but for one button the owner and
 * admins have: "Don't use this layout" (and "Use it again").
 */

const inspirationHref: Route = '/inspiration'
const n = (v: number) => new Intl.NumberFormat('en-GB').format(v)

export function LibraryScreen({ view }: { view: LibraryView }) {
  const title = 'Block library'
  if (!view.ok)
    return (
      <AppPage current="inspiration" title={title}>
        {view.on ? (
          <ErrorState
            title="The library did not open"
            reason="We could not read the block library just now. Nothing was changed."
            action={
              <ButtonLink href={inspirationHref} label="Back to Inspiration" />
            }
          />
        ) : (
          <EmptyState
            title="The block library is not turned on yet"
            action={
              <ButtonLink href={inspirationHref} label="Back to Inspiration" />
            }
          />
        )}
      </AppPage>
    )
  return (
    <AppPage current="inspiration" title={title}>
      <Card label="About the block library">
        <div className="flex flex-col gap-[var(--space-3)]">
          <p className="type-number-md">{n(view.total)} layouts</p>
          <p className="type-body">
            When you create a Scratch email, GROS picks its sections from these
            layouts: the ones that fit the email’s goal and what{' '}
            {view.brandName} can fill, the ones used most, and not the same ones
            every time. Each is shown in your brand’s look. Only the layout
            comes from another brand’s email, never its words, pictures or logo.
          </p>
        </div>
      </Card>
      {view.kinds.length === 0 ? (
        <EmptyState
          title="No layouts yet: they arrive as the brands you follow send emails"
          action={
            <ButtonLink href={inspirationHref} label="Back to Inspiration" />
          }
        />
      ) : (
        view.kinds.map((k) => (
          <Card key={k.kind} label={kindWords[k.kind]}>
            <div className="flex flex-col gap-[var(--space-5)]">
              <h2 className="type-heading">
                {kindWords[k.kind]} ({n(k.count)})
              </h2>
              <ActionAnswers>
                <CardRow columns={3}>
                  {k.shown.map((b) => (
                    <Layout key={b.id} block={b} manager={view.manager} />
                  ))}
                </CardRow>
              </ActionAnswers>
            </div>
          </Card>
        ))
      )}
    </AppPage>
  )
}

function Layout({ block, manager }: { block: ShownBlock; manager: boolean }) {
  const used = `Used ${n(block.uses)} ${block.uses === 1 ? 'time' : 'times'}`
  const words = [
    used,
    block.brands > 1 ? `by ${n(block.brands)} brands` : '',
    block.yours ? 'Yours' : '',
    block.hidden ? 'Not used for your emails' : ''
  ].filter(Boolean)
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <iframe
        title={`${kindWords[block.kind]} layout, ${used.toLowerCase()}`}
        sandbox=""
        referrerPolicy="no-referrer"
        // Sanitized again on the server: links removed, a strict CSP.
        srcDoc={toSafePreview(block.html)?.html ?? ''}
        className="h-[16rem] w-full rounded-[var(--radius-md)] bg-[var(--white)]"
      />
      <p className="type-caption text-[var(--stone)]">{words.join(' · ')}</p>
      {manager ? (
        <ActionButton
          action={setLayoutHidden}
          kind="outline"
          label={block.hidden ? 'Use it again' : 'Don’t use this layout'}
          spokenLabel={`${block.hidden ? 'Use it again' : 'Don’t use this layout'}: ${kindWords[block.kind]}, ${used.toLowerCase()}`}
          fields={{ block: block.id, hide: block.hidden ? '0' : '1' }}
        />
      ) : null}
    </div>
  )
}
