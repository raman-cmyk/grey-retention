import { OwnLibraryPanel } from '@/features/library/panel'
import { EmptyState } from '@/components/ui/empty-state'
import { TextLink } from '@/components/ui/text-link'
import Link from 'next/link'
import { PageHeading, Panel, Notice } from '@/components/ui/workspace'
import { referenceWorkspace } from '@/features/references/data'
export default async function EmailLibrary() {
  const { data, context, error } = await referenceWorkspace()
  const owner = context.tenantRole === 'owner'
  if (!data) return <Notice error>{error}</Notice>
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Subscribed email library"
        description="Original synthetic records from active subscribed sources. Only safe text previews and structural evidence are available; private workspace rules stay private."
      />
      <OwnLibraryPanel />
      <Panel title={`${data.emails.length} captured reference emails`}>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.emails.map((e) => (
            <article
              key={e.id}
              className="rounded-xl border border-[var(--line)] p-4 text-sm"
            >
              <p className="mb-2 text-xs text-[var(--text-muted)]">
                Synthetic · {new Date(e.received_at).toISOString()}
              </p>
              <h3 className="leading-6 font-semibold">{e.subject}</h3>
              <p className="my-3 line-clamp-3 text-[var(--text-muted)]">
                {e.text_content}
              </p>
              <Link href={`/email-library/${e.id}`} className="underline">
                Open safe preview and evidence
              </Link>
            </article>
          ))}
        </div>
        {!data.emails.length && (
          <EmptyState
            title="No captured emails yet."
            description={
              <>
                Emails appear here after a sample capture runs for a watched
                brand; real inboxes are not connected yet. Emails you paste or
                upload are kept under{' '}
                <Link href="/import-reference" className="underline">
                  Add an email
                </Link>
                .
              </>
            }
            action={
              owner ? (
                <TextLink href="/competitor-agent">Add a competitor</TextLink>
              ) : undefined
            }
          />
        )}
      </Panel>
    </div>
  )
}
