import { libraryEmails } from './library'
import type { GoldenEmail } from './report'
import { uploadEmails } from './uploads'

/** DES-ENGINE-001: the 40 golden emails, 20 library-shaped then 20 upload-shaped. */
export const goldenEmails: readonly GoldenEmail[] = [
  ...libraryEmails.map((e) => ({ ...e, shape: 'library' as const })),
  ...uploadEmails.map((e) => ({ ...e, shape: 'upload' as const }))
]
