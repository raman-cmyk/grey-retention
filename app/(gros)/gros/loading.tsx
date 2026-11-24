import { LoadingPage } from '@/components/gros/nav'

/** Ask GROS is opening: the bar at once, the chats when they are read. */
export default function AskLoading() {
  return (
    <LoadingPage current="ask" title="Ask GROS" words="Opening your chats" />
  )
}
