import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { readUploads } from '@/features/email-uploads/data'
import { UploadsScreen } from '@/features/email-uploads/screen'

export const metadata: Metadata = { title: 'Add your own email' }

// Adding an email reads its pictures (from the file, or from the fixed
// picture hosts) before it is saved.
export const maxDuration = 120

/**
 * DES-ENGINE-003: "Add your own email" (Inspiration). Each render brings a
 * new request key, so an email added twice from one page is saved once.
 */
export default async function AddOwnEmailPage() {
  const context = await requireRequestContext('client')
  return (
    <UploadsScreen
      view={await readUploads(context)}
      requestKey={randomUUID()}
    />
  )
}
