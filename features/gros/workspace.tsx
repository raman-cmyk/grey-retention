import { Notice } from '@/components/ui/workspace'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { BrandCheck } from '@/features/brand-profile/brand-check'
import { Conversation } from './conversation'
import { grosView } from './data'
import { greeting } from './model'
import { ProposalList, ProposeChange } from './proposals'
import { ThreadHeader } from './thread-header'
import { ThreadList } from './thread-list'

type Context = Pick<
  ClientRequestContext,
  'tenantId' | 'userId' | 'tenantRole' | 'timezone'
>

/**
 * Ask GROS (UI_REBUILD_SPEC §8): two panes that fill the screen height.
 * Left: the chats this member can see. Right: one chat, or a new chat that
 * is saved only when its first question is sent.
 */
export async function GrosWorkspace({
  ctx,
  chatId,
  before
}: {
  ctx: Context
  /** Undefined for a new chat. */
  chatId?: string
  before?: number
}) {
  const view = await grosView(ctx, { chatId, before })
  if (!view)
    return (
      <Notice error>
        We could not load your chats. Reload the page to try again.
      </Notice>
    )
  const thread = view.thread
  return (
    <div className="grid h-[calc(100dvh-6.5rem)] min-h-[32rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface)] lg:h-[calc(100dvh-5rem)] lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1">
      <ThreadList
        threads={view.threads}
        activeId={thread?.id ?? null}
        templates={view.templates}
        nowMs={view.now}
      />
      <section
        aria-label={thread ? `Chat: ${thread.title}` : 'New chat'}
        className="flex min-h-0 flex-col"
      >
        {view.unavailable ? (
          <div className="p-6">
            <Notice>
              This chat isn’t available. It may be private to the person who
              started it, or it was deleted.
            </Notice>
          </div>
        ) : (
          <>
            {thread ? (
              <ThreadHeader
                key={thread.id}
                chat={thread.id}
                title={thread.title}
                visibility={thread.visibility}
                mine={thread.mine}
              />
            ) : (
              <header className="space-y-1 border-b border-[var(--line)] px-4 py-3">
                <h2 className="text-base font-semibold">New private chat</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Saved when you send your first question. Only you can see it
                  until you share it.
                </p>
              </header>
            )}
            <div className="px-4 pt-3 empty:hidden">
              <BrandCheck tenantId={ctx.tenantId} action="GROS answers" />
            </div>
            <Conversation
              key={thread?.id ?? 'new'}
              chat={thread?.id ?? null}
              greeting={greeting(view.userName)}
              messages={thread?.messages ?? []}
              earlierBefore={thread?.earlierBefore ?? null}
              paged={thread?.paged ?? false}
              campaigns={view.campaigns}
            >
              {thread && (
                <div className="mt-4 space-y-3">
                  <ProposalList
                    chat={thread.id}
                    proposals={thread.proposals}
                    timezone={ctx.timezone}
                  />
                  {thread.mine || thread.visibility === 'shared' ? (
                    <ProposeChange
                      chat={thread.id}
                      campaigns={view.campaigns}
                      references={view.references}
                      owner={ctx.tenantRole === 'owner'}
                    />
                  ) : null}
                </div>
              )}
            </Conversation>
          </>
        )}
      </section>
    </div>
  )
}
