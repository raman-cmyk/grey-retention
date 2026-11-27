import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { uploadPictureLinks } from '@/features/email-build/library-copy-live'
import type { UseEmailInput } from '@/features/inspiration/use-view'
import { latestPlanRun } from '@/features/strategy/load'
import { planScreen } from '@/features/strategy/plan-screen'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { uploadBucket } from './intake'
import { withUploadPictures } from './pictures'
import { uploadCopyOn } from './switch'

/**
 * DES-ENGINE-003b: what "Use this design" reads for one of the
 * workspace's own uploaded emails: the upload, read with the member's own
 * session (row level security: this workspace only), only when it is
 * ready; its prepared HTML for the preview (the server reads it, as the
 * member may see the row), an own design's pictures at short signed links;
 * and the latest plan, as the Plan screen reads it. Create email checks
 * the upload again under the workspace lock.
 */

const held =
  /\ssrc="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]*"\s+data-de-src="(https:\/\/email-uploads\.invalid\/\d{1,2}\.(?:png|jpg|gif|webp))"/g

export async function readUseUpload(
  context: Pick<ClientRequestContext, 'tenantId' | 'tenantRole' | 'timezone'>,
  upload: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<UseEmailInput> {
  const db = await createClient()
  if (!db) return { ok: false }
  const owner = context.tenantRole === 'owner'
  const [found, run] = await Promise.all([
    upload && uploadCopyOn(env)
      ? db
          .from('email_uploads')
          .select('id,tenant_id,name,design,state,created_at')
          .eq('id', upload)
          .eq('tenant_id', context.tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    latestPlanRun(context.tenantId, context.timezone)
  ])
  if (found.error || !run.ok) return { ok: false }
  const plan = planScreen(run.run, { owner: true })
  const row = found.data
  if (!row || row.state !== 'ready')
    return { ok: true, owner, email: null, plan }
  let html = '<p>This email’s preview could not be read.</p>'
  const service = createServiceClient()
  if (service) {
    const file = await service.storage
      .from(uploadBucket)
      .download(`${row.tenant_id}/${row.id}/email.html`)
    if (!file.error && file.data) {
      html = await file.data.text()
      if (row.design === 'own') {
        const links = await uploadPictureLinks(service, row.tenant_id, row.id)
        if (links)
          html = withUploadPictures(
            html.replace(
              held,
              (_, placeholder: string) => ` src="${placeholder}"`
            ),
            links
          )
      }
    }
  }
  return {
    ok: true,
    owner,
    email: {
      id: row.id,
      subject: row.name,
      from: row.design === 'own' ? 'Your own design' : 'Another brand’s email',
      at: row.created_at,
      html,
      unready: null,
      upload: row.design === 'other' ? 'other' : 'own'
    },
    plan
  }
}
