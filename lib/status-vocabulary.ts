/**
 * The one list of operator statuses (feature UX-012, docs/DESIGN.md → Status
 * marks). Every screen that shows one of these states uses the same word, tone
 * and meaning, so "Scheduled" never means two different things.
 */
export const operatorStatuses = {
  collecting: {
    label: 'Collecting',
    tone: 'info',
    meaning: 'We are waiting for or receiving emails from this source.'
  },
  ready: {
    label: 'Ready',
    tone: 'success',
    meaning: 'Everything needed is in place; you can continue.'
  },
  needs_setup: {
    label: 'Needs setup',
    tone: 'warning',
    meaning: 'Something must be connected or filled in before this can work.'
  },
  in_production: {
    label: 'In production',
    tone: 'neutral',
    meaning: 'Copy, design or preparation is being worked on.'
  },
  needs_review: {
    label: 'Needs review',
    tone: 'warning',
    meaning: 'Waiting for the brand owner to check and approve it.'
  },
  scheduled: {
    label: 'Scheduled',
    tone: 'info',
    meaning: 'Approved and set to send at a fixed time.'
  },
  sending: {
    label: 'Sending',
    tone: 'info',
    meaning: 'The send has started and is not confirmed yet.'
  },
  sent: {
    label: 'Sent',
    tone: 'success',
    meaning: 'The email platform confirmed the send.'
  },
  failed: {
    label: 'Failed',
    tone: 'danger',
    meaning: 'It stopped with an error; open it to see what to do next.'
  }
} as const satisfies Record<
  string,
  {
    label: string
    tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
    meaning: string
  }
>

export type OperatorStatus = keyof typeof operatorStatuses
export type StatusTone =
  (typeof operatorStatuses)[OperatorStatus]['tone'] | 'neutral'
