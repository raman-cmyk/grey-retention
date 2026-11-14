import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Brand voice' }

// Brand Truth and Copy & Voice are one Brand profile page now (owner brief
// §18 decision 5); the old Copy & Voice address opens that part of it.
export default function CopyAndVoicePage() {
  redirect('/brand#voice')
}
