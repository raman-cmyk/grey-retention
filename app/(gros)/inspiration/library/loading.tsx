import { LoadingPage } from '@/components/gros/nav'

/** The block library is opening: the bar at once, the layouts when drawn. */
export default function BlockLibraryLoading() {
  return (
    <LoadingPage
      current="inspiration"
      title="Block library"
      words="Drawing the layouts in your brand’s look"
    />
  )
}
