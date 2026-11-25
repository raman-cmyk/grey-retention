import { LoadingPage } from '@/components/gros/nav'

/** The Brand book is opening: the bar at once, the cards when it is read. */
export default function BrandBookLoading() {
  return (
    <LoadingPage
      current="settings"
      title="Brand book"
      words="Opening your Brand book"
    />
  )
}
