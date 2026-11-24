import { AdminLoadingPage } from '@/components/gros/admin-nav'

/** Operations is opening: the bar at once, the cards when read. */
export default function OperationsLoading() {
  return (
    <AdminLoadingPage
      current="operations"
      title="Operations"
      words="Opening Operations"
    />
  )
}
