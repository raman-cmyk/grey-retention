import { LoadingPage } from '@/components/gros/nav'

/** Settings is opening: the bar at once, the cards when their data is read. */
export default function SettingsLoading() {
  return (
    <LoadingPage current="settings" title="Settings" words="Opening Settings" />
  )
}
