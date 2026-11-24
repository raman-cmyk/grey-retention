import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { AppPage, defaultAssistant } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { Status } from '@/components/gros/status'
import { Field } from '@/components/gros/input'
import { cn } from '@/lib/utils'
import { grosAction } from './actions'
import { Composer } from './composer'
import { Choice } from './fields'
import type { AskView, ChatItem, ChatProposal, OpenChat } from './read-model'

/**
 * Ask GROS (UI-ASK): the one page with a side list (BRAND.md Nav). Past
 * chats on the left in a white card with list rows and a small form to
 * start one; the open chat on the right in a white card, its messages and
 * the composer with one main button (Send); the chat's proposals in their
 * own card under it, each with its exact change and, for the member who
 * asked, Confirm change and Reject change. The brand check (when the
 * profile looks like another brand) sits above. With no chats the page is
 * the empty state and its one button starts a private chat.
 */
export function AskScreen({
  view,
  assistant = defaultAssistant,
  brandNote = null
}: {
  view: AskView
  /** The assistant's name (the white label may rename it). */
  assistant?: string
  /** The brand check card, read on the server (null when nothing differs). */
  brandNote?: ReactNode
}) {
  const title = `Ask ${assistant}`
  return (
    <AppPage current="ask" title={title} assistant={assistant}>
      {view.kind === 'unread' ? (
        <ErrorState
          title="Chats did not open"
          reason={view.reason}
          action={<ButtonLink href="/gros" label="Try again" />}
        />
      ) : (
        <>
          {brandNote}
          {view.chats.length === 0 && !view.open ? (
            view.missing ? (
              <MissingChat />
            ) : (
              <EmptyState
                title="No chats yet"
                action={
                  <ActionButton
                    action={grosAction}
                    label="Start a chat"
                    fields={{
                      kind: 'create',
                      title: 'First chat',
                      visibility: 'private'
                    }}
                  />
                }
              />
            )
          ) : (
            <div className="grid grid-cols-1 items-start gap-[var(--space-5)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              <ChatsCard chats={view.chats} open={view.open?.id ?? null} />
              <div className="flex min-w-0 flex-col gap-[var(--space-5)]">
                {view.missing || !view.open ? (
                  <MissingChat />
                ) : (
                  <>
                    <ChatCard
                      chat={view.open}
                      assistant={assistant}
                      campaigns={view.campaigns}
                      references={view.references}
                      owner={view.owner}
                    />
                    {view.open.proposals.length ? (
                      <ProposalsCard proposals={view.open.proposals} />
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </AppPage>
  )
}

const chatHref = (id: string, before?: number) =>
  (before === undefined
    ? `/gros?chat=${id}`
    : `/gros?chat=${id}&before=${before}`) as Route

const whoSees = (chat: ChatItem) =>
  [
    chat.shared ? 'Shared' : 'Private',
    chat.mine ? 'Started by you' : 'Started by a teammate'
  ].join(' · ')

/** A chat that is private to someone else or in another workspace. */
function MissingChat() {
  return (
    <ErrorState
      title="Chat not available"
      reason="It is private to the person who started it, or it belongs to another workspace. Choose one of your chats."
      action={<ButtonLink href="/gros" label="Show your chats" />}
    />
  )
}

/** The side list: past chats, the open one marked, and Start chat. */
function ChatsCard({
  chats,
  open
}: {
  chats: readonly ChatItem[]
  open: string | null
}) {
  return (
    <Card label="Chats">
      <div className="flex flex-col gap-[var(--space-6)]">
        <h2 className="type-heading">Chats</h2>
        {chats.length ? (
          <nav aria-label="Conversations">
            <ul className="gros-rows flex flex-col">
              {chats.map((chat) => (
                <li key={chat.id}>
                  <Link
                    href={chatHref(chat.id)}
                    aria-current={chat.id === open ? 'page' : undefined}
                    className={cn(
                      'gros-row flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)]',
                      chat.id === open && 'bg-[var(--lime-soft)]'
                    )}
                  >
                    <span className="type-body-strong break-words">
                      {chat.title}
                    </span>
                    <span
                      className={cn(
                        'type-caption',
                        chat.id === open
                          ? 'text-[var(--ink-soft)]'
                          : 'text-[var(--stone)]'
                      )}
                    >
                      {whoSees(chat)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <ActionButton
          action={grosAction}
          label="Start chat"
          fields={{ kind: 'create' }}
        >
          <Field
            label="Chat name"
            name="title"
            autoComplete="off"
            maxLength={200}
            required
          />
          <Choice
            id="chat-visibility"
            label="Who can see it"
            name="visibility"
            defaultValue="private"
            options={[
              { value: 'private', label: 'Only me' },
              { value: 'shared', label: 'Everyone in the workspace' }
            ]}
          />
        </ActionButton>
      </div>
    </Card>
  )
}

/** The open chat: its messages, older pages, and the composer. */
function ChatCard({
  chat,
  assistant,
  campaigns,
  references,
  owner
}: {
  chat: OpenChat
  assistant: string
  campaigns: readonly { id: string; title: string }[]
  references: readonly { id: string; subject: string }[]
  owner: boolean
}) {
  return (
    <Card label={chat.title}>
      <div className="flex flex-col gap-[var(--space-6)]">
        <ActionAnswers>
          <div className="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
            <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <h2 className="type-heading break-words">{chat.title}</h2>
              <p className="type-caption text-[var(--stone)]">
                {whoSees(chat)}
              </p>
            </div>
            {/* Only the member who started a chat changes who sees it. */}
            {chat.mine ? (
              <ActionButton
                action={grosAction}
                label={chat.shared ? 'Make private' : 'Share chat'}
                kind="quiet"
                fields={{
                  kind: 'visibility',
                  chat: chat.id,
                  visibility: chat.shared ? 'private' : 'shared'
                }}
                confirm={
                  chat.shared
                    ? undefined
                    : 'Everyone in your workspace will see this whole chat. Share it?'
                }
              />
            ) : null}
          </div>
          {chat.earlier !== null ? (
            <ButtonLink
              href={chatHref(chat.id, chat.earlier)}
              label="Show earlier messages"
              kind="quiet"
            />
          ) : null}
          {chat.messages.length ? (
            <ol
              aria-label="Messages"
              className="flex flex-col gap-[var(--space-4)]"
            >
              {chat.messages.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    'flex max-w-[88%] flex-col gap-[var(--space-1)]',
                    m.fromGros
                      ? 'self-start'
                      : 'gros-tile self-end rounded-[var(--radius-md)] bg-[var(--mist)]'
                  )}
                >
                  <p className="type-caption text-[var(--stone)]">
                    {m.fromGros ? assistant : m.byYou ? 'You' : 'A teammate'}
                  </p>
                  <p className="type-body break-words whitespace-pre-wrap">
                    {m.body}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <h3 className="type-body-strong">
              {chat.paged ? 'No earlier messages' : 'No messages yet'}
            </h3>
          )}
          {chat.paged ? (
            <ButtonLink
              href={chatHref(chat.id)}
              label="Show latest messages"
              kind="quiet"
            />
          ) : null}
          {campaigns.length ? (
            <Composer
              // A fresh composer for each chat (the request starts at Explain).
              key={chat.id}
              chat={chat.id}
              campaigns={campaigns}
              references={references}
              owner={owner}
            />
          ) : (
            <div className="flex flex-col items-start gap-[var(--space-3)]">
              <p className="type-body text-[var(--stone)]">
                Plan your emails first, then ask about them here.
              </p>
              <ButtonLink href="/plan" label="Open your plan" />
            </div>
          )}
        </ActionAnswers>
      </div>
    </Card>
  )
}

/**
 * The chat's exact proposals, newest first. Only the member who asked can
 * confirm or reject one, while it is pending (15 minutes); the command
 * checks the exact change and every campaign version again.
 */
function ProposalsCard({ proposals }: { proposals: readonly ChatProposal[] }) {
  const first = proposals.find((p) => p.canDecide)?.id
  return (
    <Card label="Proposals">
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <h2 className="type-heading">Proposals</h2>
          <ul
            aria-label="Proposals"
            className="flex flex-col gap-[var(--space-3)]"
          >
            {proposals.map((p) => (
              <li
                key={p.id}
                className="gros-tile flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--mist)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
                  <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
                    <h3 className="type-body-strong">{p.title}</h3>
                    <p className="type-caption text-[var(--stone)]">
                      {[p.state, p.ends ? `Ends ${p.ends}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {p.canDecide ? <Status kind="needs_you" /> : null}
                </div>
                <p className="type-body break-words">{p.consequence}</p>
                <details>
                  <summary className="type-caption cursor-pointer text-[var(--ink)]">
                    Show the exact change
                  </summary>
                  <pre className="type-caption mt-[var(--space-3)] overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--white)] p-[var(--space-3)] break-words whitespace-pre-wrap">
                    {p.payload}
                  </pre>
                </details>
                {p.canDecide ? (
                  <div className="flex flex-wrap items-start gap-[var(--space-2)]">
                    <ActionButton
                      action={grosAction}
                      label="Confirm change"
                      spokenLabel={p.title}
                      kind={p.id === first ? 'main' : 'outline'}
                      size="row"
                      fields={{
                        kind: 'decide',
                        proposal: p.id,
                        hash: p.hash,
                        decision: 'confirmed'
                      }}
                    />
                    <ActionButton
                      action={grosAction}
                      label="Reject change"
                      spokenLabel={p.title}
                      kind="quiet"
                      fields={{
                        kind: 'decide',
                        proposal: p.id,
                        hash: p.hash,
                        decision: 'rejected'
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </ActionAnswers>
      </div>
    </Card>
  )
}
