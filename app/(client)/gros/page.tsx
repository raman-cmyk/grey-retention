import { PageHeading } from '@/components/ui/workspace'
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
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Ask GROS"
        description="Private and shared conversations, evidence explanations and explicit version-bound proposals."
      />
      <GrosPanel
        chatId={validChatId(p.chat)}
        before={validMessageCursor(p.before)}
      />
    </div>
  )
}
