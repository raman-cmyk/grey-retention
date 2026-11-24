import { LoadingPage } from '@/components/gros/nav'

/** A list's page is opening: the bar at once, the cards when read. */
export default function ListLoading() {
  return (
    <LoadingPage current="audiences" title="List" words="Opening the list" />
  )
}
