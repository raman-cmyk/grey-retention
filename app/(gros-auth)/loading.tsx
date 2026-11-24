import { FocusLoading } from '@/components/gros/steps'

/** A sign-in or account screen is opening: the shell at once, no `main`. */
export default function AuthLoading() {
  return <FocusLoading words="Opening" />
}
