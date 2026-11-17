import { LoadingPage } from '@/components/gros/nav'

/** Holidays is opening: the bar at once, the cards when their data is read. */
export default function HolidaysLoading() {
  return (
    <LoadingPage
      current="settings"
      title="Holidays and events"
      words="Opening holidays and events"
    />
  )
}
