import { LoadingPage } from '@/components/gros/nav'

/** Home is opening: the bar at once, the cards when their data is read. */
export default function HomeLoading() {
  return <LoadingPage current="home" title="Home" words="Opening Home" />
}
