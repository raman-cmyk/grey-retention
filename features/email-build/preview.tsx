import 'server-only'
import { notFound } from 'next/navigation'
import { Notice, Panel } from '@/components/ui/workspace'
import { Pill } from '@/components/ui/pill'
import { createClient } from '@/lib/supabase/server'
import { previewHtml } from '@/features/email-generation/html'
import { ScaledFrame } from '@/features/email-generation/scaled-frame'
import { builtEmail } from './build'
import { changeWords, type ChangeKey } from './content'

/**
 * One created email (EML-004 part 2): what lands in Klaviyo as a draft, in
 * a sandboxed frame, with plain notes on how it was made. RLS: members
 * read their own workspace's builds.
 */
export async function BuiltEmailPreview({
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
    return data.state === 'failed' ? (
      <Notice error>
        We could not create this email. Go back to the plan to try again.
      </Notice>
    ) : (
      <Notice>This email is still being created. Go back to the plan.</Notice>
    )
  const e = email.data
  const changes = e.changes.filter((c): c is ChangeKey => c in changeWords)
  return (
    <div className="space-y-6">
      <Panel title={e.name}>
        <div className="mb-4 flex flex-wrap gap-2">
          {data.state === 'failed' ? (
            <Pill tone="danger">Not put into Klaviyo</Pill>
          ) : data.state !== 'drafted' ? (
            <Pill tone="info">Being put into Klaviyo</Pill>
          ) : data.sample_draft ? (
            <Pill tone="info">Sample draft (not in Klaviyo)</Pill>
          ) : (
            <Pill tone="success">In Klaviyo as a draft</Pill>
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
        {/* The project's safe preview: active content and outside loads removed, a strict CSP. */}
        <ScaledFrame
          title={`The email: ${e.subject}`}
          srcDoc={previewHtml(e.html).html}
          height={1400}
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
