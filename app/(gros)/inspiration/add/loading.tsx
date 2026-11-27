import { LoadingPage } from '@/components/gros/nav'

/** "Add your own email" is opening: the bar at once, the list when read. */
export default function AddOwnEmailLoading() {
  return (
    <LoadingPage
      current="inspiration"
      title="Add your own email"
      words="Opening your emails"
    />
  )
}
