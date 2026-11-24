import { LoadingPage } from '@/components/gros/nav'

/** Account is opening: the bar at once, the cards when the profile is read. */
export default function AccountLoading() {
  return (
    <LoadingPage
      current="settings"
      title="Account"
      words="Opening your account"
    />
  )
}
