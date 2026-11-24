import { AdminLoadingPage } from '@/components/gros/admin-nav'

/** The inbox is opening: the bar at once, the cards when read. */
export default function InboxLoading() {
  return (
    <AdminLoadingPage
      current="inbox"
      title="Inspiration inbox"
      words="Opening the inbox"
    />
  )
}
