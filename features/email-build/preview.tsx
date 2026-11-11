import 'server-only'
import { notFound } from 'next/navigation'
import { Notice, Panel } from '@/components/ui/workspace'
import { Pill } from '@/components/ui/pill'
import { createClient } from '@/lib/supabase/server'
import { builtEmail } from './build'
import { changeWords, type ChangeKey } from './content'

/**
 * One created email (EML-004 part 2): what lands in Klaviyo as a draft, in
 * a sandboxed frame, with plain notes on how it was made. RLS: members
 * read their own workspace's builds.
 */
export async function EmailPreview({
  tenantId,
  buildId
}: {
  tenantId: string
  buildId: string
}) {
  const db = await createClient()
  if (!db)
    return <Notice error>We could not load this email. Reload the page.</Notice>
  const { data, error } = await db
    .from('email_builds')
    .select('id,state,email,klaviyo_campaign_id,sample_draft')
    .eq('tenant_id', tenantId)
    .eq('id', buildId)
    .maybeSingle()
  if (error)
    return <Notice error>We could not load this email. Reload the page.</Notice>
  if (!data) notFound()
  const email = builtEmail.safeParse(data.email)
  if (!email.success)
    return <Notice>This email is not ready yet. Go back to the plan.</Notice>
  const e = email.data
  const changes = e.changes.filter((c): c is ChangeKey => c in changeWords)
  return (
    <div className="space-y-6">
      <Panel title={e.name}>
        <div className="mb-4 flex flex-wrap gap-2">
          {data.state === 'drafted' ? (
            <Pill tone="success">In Klaviyo as a draft</Pill>
          ) : (
            <Pill tone="info">Being put into Klaviyo</Pill>
          )}
          <Pill>
            {e.approach === 'A' ? 'Coded sections' : 'Designed top picture'}
          </Pill>
        </div>
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="inline font-medium">Subject: </dt>
            <dd className="inline break-words">{e.subject}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Preview line: </dt>
            <dd className="inline break-words">{e.preheader}</dd>
          </div>
        </dl>
        <div className="mt-4 space-y-2">
          {e.sample && (
            <Notice>
              This email uses a sample store until your own store is connected.
              The products and offers are examples.
            </Notice>
          )}
          {data.sample_draft && (
            <Notice>
              Klaviyo is not connected yet, so this is a sample draft: nothing
              was sent to Klaviyo.
            </Notice>
          )}
          {!e.ai && (
            <Notice>
              The AI was not used for this email: it has plain words built from
              your store&apos;s facts.
            </Notice>
          )}
          {changes.length > 0 && (
            <Notice>
              {`Some planned content could not be used, so safer choices were made: ${changes
                .map((c) => changeWords[c])
                .join('; ')}.`}
            </Notice>
          )}
        </div>
      </Panel>
      <Panel title="The email">
        <iframe
          title={`The email: ${e.subject}`}
          srcDoc={e.html}
          sandbox=""
          className="h-[900px] w-full rounded-lg border border-[var(--line)] bg-white"
        />
      </Panel>
      <a
        className="text-sm font-medium underline underline-offset-2"
        href="/plan"
      >
        Back to the plan
      </a>
    </div>
  )
}
