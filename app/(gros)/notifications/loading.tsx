import { LoadingPage } from '@/components/gros/nav'

/** Notifications are opening: the bar at once, the list when it is read. */
export default function NotificationsLoading() {
  return (
    <LoadingPage
      current="notices"
      title="Notifications"
      words="Opening Notifications"
    />
  )
}
