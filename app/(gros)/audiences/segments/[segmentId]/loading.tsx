import { LoadingPage } from '@/components/gros/nav'

/** A segment's page is opening: the bar at once, the cards when read. */
export default function SegmentLoading() {
  return (
    <LoadingPage
      current="audiences"
      title="Segment"
      words="Opening the segment"
    />
  )
}
