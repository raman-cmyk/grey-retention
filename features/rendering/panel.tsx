import Image from 'next/image'
import type { Database } from '@/lib/supabase/database.types'
import { Panel, Notice, Field, controlClass } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { renderData } from './data'
import { renderAction } from './actions'
import { StructurePicker } from '@/features/library/source-picker'
export async function RenderPanel({
  campaign: c,
  owner
}: {
  campaign: Database['public']['Tables']['campaigns']['Row']
  owner: boolean
}) {
  const data = await renderData(
    c.tenant_id,
    c.id,
    (c.lineage as { structureId?: string })?.structureId
  )
  if (!data) return <Notice error>Render data unavailable.</Notice>
  const r = data.latest,
    current =
      r?.revision === c.design_revision && r.copy_revision === c.copy_revision
  return (
    <Panel title="Original fixture design path">
      <Notice>
        Synthetic reference structures use your approved copy, kit and private
        assets. Three inspectable SVG strips are produced for design emails;
        readable text emails use no image slices. Owner approval remains
        required. Live email compatibility and visual quality are unverified.
      </Notice>
      {owner && c.copy_state === 'approved' && (
        <ActionForm
          action={renderAction}
          className="mt-4 grid gap-4 sm:grid-cols-2"
        >
          <input name="kind" type="hidden" value="render" />
          <input name="id" type="hidden" value={c.id} />
          <input name="copy" type="hidden" value={c.copy_revision} />
          <input name="design" type="hidden" value={c.design_revision} />
          <StructurePicker
            label="Rendering structure"
            templates={data.templates}
            references={data.references}
            allowFixture
            defaultSource={
              (c.lineage as { structureSource?: string })?.structureSource
            }
            defaultId={(c.lineage as { structureId?: string })?.structureId}
          />
          <div>
            <SubmitButton variant="secondary">
              {c.design_state === 'revisions_requested'
                ? 'Queue requested strip revision'
                : 'Queue original fixture design'}
            </SubmitButton>
          </div>
        </ActionForm>
      )}
      {!r && c.design_state === 'owner_approved' && (
        <Notice>
          This design was approved as a designer upload before designers were
          retired. The delivery package uses it; a new design needs your
          approval again.
        </Notice>
      )}
      {r && (
        <div className="mt-5">
          <h3 className="mb-4 font-semibold">
            Fixture design v{r.revision} · copy v{r.copy_revision}
          </h3>
          {!current && (
            <Notice error>
              Historical design: current inputs need a new render and approval.
            </Notice>
          )}
          {c.channel === 'email_text' && (
            <Notice>
              Text design review applies to the exact approved copy. No raster
              artifact is required.
            </Notice>
          )}
          <div className="space-y-2">
            {data.strips.map((s) => (
              <div key={s.path}>
                <h4 className="mb-2 text-sm capitalize">{s.section}</h4>
                {s.preview ? (
                  <Image
                    src={s.preview}
                    width={600}
                    height={320}
                    unoptimized
                    loading="eager"
                    alt={`Original synthetic ${s.section} strip`}
                    className="h-auto w-full max-w-[600px] rounded border border-[var(--line)]"
                  />
                ) : (
                  <Notice error>Private strip unavailable.</Notice>
                )}
              </div>
            ))}
          </div>
          {owner && current && c.design_state === 'submitted' && (
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <ActionForm action={renderAction} className="grid gap-3">
                <input name="kind" type="hidden" value="review" />
                <input name="id" type="hidden" value={r.id} />
                <input name="revision" type="hidden" value={r.revision} />
                <input name="decision" type="hidden" value="revision" />
                <Field label="Fixture strip to revise">
                  <select name="section" className={controlClass}>
                    <option value="hero">Hero</option>
                    <option value="copy">Copy</option>
                    <option value="cta">CTA</option>
                  </select>
                </Field>
                <Field label="Fixture section feedback">
                  <textarea
                    name="feedback"
                    className={controlClass}
                    minLength={5}
                    required
                  />
                </Field>
                <div>
                  <SubmitButton variant="secondary">
                    Request fixture strip revision
                  </SubmitButton>
                </div>
              </ActionForm>
              <ConfirmDialog
                label="Review fixture design approval"
                title={`Approve exact fixture design v${r.revision}`}
                description="Confirm this exact version implements the approved copy and chosen assets. Later changes invalidate approval."
              >
                <ActionForm action={renderAction}>
                  <input name="kind" type="hidden" value="review" />
                  <input name="id" type="hidden" value={r.id} />
                  <input name="revision" type="hidden" value={r.revision} />
                  <input name="decision" type="hidden" value="approved" />
                  <input name="section" type="hidden" value="whole_design" />
                  <input
                    name="feedback"
                    type="hidden"
                    value="Owner approved exact fixture version."
                  />
                  <SubmitButton>
                    Approve exact fixture design v{r.revision}
                  </SubmitButton>
                </ActionForm>
              </ConfirmDialog>
            </div>
          )}
          {current && c.design_state === 'owner_approved' && (
            <Notice>Owner approved exact fixture design v{r.revision}.</Notice>
          )}
          <details className="mt-4">
            <summary>Render provenance and section history</summary>
            <pre className="overflow-auto text-xs">
              {JSON.stringify(r.input_revisions, null, 2)}
            </pre>
            {data.reviews.map((v) => (
              <p key={v.id} className="mt-2 text-sm">
                {v.section} · {v.decision}: {v.feedback}
              </p>
            ))}
          </details>
        </div>
      )}
    </Panel>
  )
}
