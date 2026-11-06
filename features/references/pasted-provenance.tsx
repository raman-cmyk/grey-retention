import { z } from 'zod'
import { Panel, Notice } from '@/components/ui/workspace'
import { pastedReference } from './pasted-data'
import { PastedText } from './pasted-text'

const lineageSchema = z.object({
  structureSource: z.literal('imported_reference'),
  structureId: z.uuid(),
  structure: z.array(z.string()).catch([])
})

export async function PastedSourcePanel({
  tenantId,
  timezone,
  lineage
}: {
  tenantId: string
  timezone: string
  lineage: unknown
}) {
  const parsed = lineageSchema.safeParse(lineage)
  if (!parsed.success) return null
  const source = await pastedReference(tenantId, parsed.data.structureId)
  return (
    <Panel title="Starting point · email you added">
      {source.error ? (
        <Notice error>{source.error} Refresh to try again.</Notice>
      ) : source.data ? (
        <div className="space-y-3 text-sm leading-6">
          <p className="font-semibold break-words">{source.data.subject}</p>
          <p className="break-words text-[var(--text-muted)]">
            Added by the workspace owner ·{' '}
            {new Intl.DateTimeFormat('en', {
              dateStyle: 'medium',
              timeZone: timezone
            }).format(new Date(source.data.created_at))}
            {source.data.source_description &&
              ` · ${source.data.source_description}`}
          </p>
          <p>
            This draft follows its outline only:{' '}
            {parsed.data.structure.join(' · ')}. It is not collected competitor
            evidence. Its wording, images, links and offers were not copied, and
            no AI analysis or visual reconstruction has run.
          </p>
          <details>
            <summary className="cursor-pointer">
              See the email you added
            </summary>
            <div className="mt-3">
              <PastedText text={source.data.readable_text} />
            </div>
          </details>
        </div>
      ) : (
        <Notice>
          The email this draft started from is no longer available here. The
          saved outline ({parsed.data.structure.join(' · ')}) is kept.
        </Notice>
      )}
    </Panel>
  )
}
