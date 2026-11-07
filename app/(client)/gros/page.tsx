import { PageHeading } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { BrandCheck } from '@/features/brand-profile/brand-check'
import {
  GrosPanel,
  validChatId,
  validMessageCursor
} from '@/features/gros/panel'
export default async function GrosPage({
  searchParams
}: {
  searchParams: Promise<{ chat?: string; before?: string }>
}) {
  const p = await searchParams
  const ctx = await requireRequestContext('client')
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Ask GROS"
        description="Private and shared conversations, evidence explanations and explicit version-bound proposals."
      />
      <BrandCheck tenantId={ctx.tenantId} action="GROS answers" />
      <GrosPanel
        chatId={validChatId(p.chat)}
        before={validMessageCursor(p.before)}
      />
    </div>
  )
}
