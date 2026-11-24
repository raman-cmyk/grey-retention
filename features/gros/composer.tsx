'use client'

import { useState } from 'react'
import { GrosButton } from './gros-button'
import { Choice, TextBox } from './fields'

/**
 * The composer at the bottom of a chat (UI-ASK): which campaign, what to
 * ask for, the question, and one main button, Send. A goal change asks for
 * the new goal and a reference for one of the subscribed references; the
 * other requests send no value. Scheduling, cancelling and asking for an
 * assignment are the owner's (the command checks the role again). Every
 * change GROS proposes waits for the asker's Confirm change.
 */
export function Composer({
  chat,
  campaigns,
  references,
  owner
}: {
  chat: string
  campaigns: readonly { id: string; title: string }[]
  references: readonly { id: string; subject: string }[]
  owner: boolean
}) {
  const [intent, setIntent] = useState('explain')
  const requests = [
    { value: 'explain', label: 'Explain and show status' },
    { value: 'edit_goal', label: 'Change the goal' },
    ...(references.length
      ? [{ value: 'select_reference', label: 'Use a reference' }]
      : []),
    ...(owner
      ? [
          { value: 'schedule', label: 'Schedule the campaign' },
          { value: 'cancel', label: 'Cancel the campaign' },
          { value: 'request_assignment', label: 'Ask for an assignment' }
        ]
      : [])
  ]
  return (
    <GrosButton label="Send" fields={{ kind: 'ask', chat }}>
      <Choice
        id="ask-campaign"
        label="Campaign"
        name="campaign"
        required
        defaultValue=""
        options={[
          { value: '', label: 'Choose a campaign' },
          ...campaigns.map((c) => ({ value: c.id, label: c.title }))
        ]}
      />
      <Choice
        id="ask-request"
        label="Request"
        name="intent"
        value={intent}
        onChange={setIntent}
        options={requests}
      />
      {intent === 'edit_goal' ? (
        <TextBox id="ask-goal" label="New goal" name="value" rows={2} />
      ) : intent === 'select_reference' ? (
        <Choice
          id="ask-reference"
          label="Reference"
          name="value"
          required
          defaultValue=""
          options={[
            { value: '', label: 'Choose a reference' },
            ...references.map((r) => ({ value: r.id, label: r.subject }))
          ]}
        />
      ) : (
        <input type="hidden" name="value" value="" />
      )}
      <TextBox
        id="ask-question"
        label="Your question"
        name="question"
        rows={3}
      />
    </GrosButton>
  )
}
