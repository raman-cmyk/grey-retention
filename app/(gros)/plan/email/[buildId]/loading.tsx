import { LoadingPage } from '@/components/gros/nav'

/** An email's page is opening: the bar at once, the email when it is read. */
export default function EmailLoading() {
  return (
    <LoadingPage current="plan" title="Your email" words="Opening your email" />
  )
}
