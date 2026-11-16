import { FocusShell } from '@/components/gros/steps'

/** Setup is opening: the shell at once, the step when it is read. */
export default function SetupLoading() {
  return (
    <FocusShell>
      <p aria-live="polite" className="type-heading">
        Opening setup
      </p>
    </FocusShell>
  )
}
