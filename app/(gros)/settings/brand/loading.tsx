import { LoadingPage } from '@/components/gros/nav'

/** Brand is opening: the bar at once, the cards when their data is read. */
export default function BrandLoading() {
  return <LoadingPage current="settings" title="Brand" words="Opening Brand" />
}
