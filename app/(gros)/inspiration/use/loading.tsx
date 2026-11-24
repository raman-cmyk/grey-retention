import { LoadingPage } from '@/components/gros/nav'

/** "Use this design" is opening: the bar at once, the email when read. */
export default function UseDesignLoading() {
  return (
    <LoadingPage
      current="inspiration"
      title="Use this design"
      words="Opening the email"
    />
  )
}
