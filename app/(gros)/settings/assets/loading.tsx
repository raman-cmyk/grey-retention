import { LoadingPage } from '@/components/gros/nav'

/** Brand assets are opening: the bar at once, the cards when they are read. */
export default function AssetsLoading() {
  return (
    <LoadingPage
      current="settings"
      title="Brand assets"
      words="Opening your brand files"
    />
  )
}
