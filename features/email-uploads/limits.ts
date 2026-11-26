/**
 * DES-ENGINE-003: the bounds and words of "Add your own email", shared by
 * the page, the server and the tests. The database checks the same bounds
 * (`supabase/migrations/20260914090100_email_uploads.sql`).
 */

/** The page (Inspiration → Add your own email). */
export const uploadsHref = '/inspiration/add'

/** The brand's own design, or another brand's email (owner decision of 25 Nov). */
export type UploadDesign = 'own' | 'other'
export const uploadDesigns = ['own', 'other'] as const

export const uploadLimits = {
  /** The file as uploaded (the bucket's and the hosting platform's limit). */
  fileBytes: 4 * 1024 * 1024,
  name: 80,
  /** Pictures kept for one own design, each and in all. */
  pictures: 40,
  pictureBytes: 3 * 1024 * 1024,
  picturesBytes: 24 * 1024 * 1024,
  /** All web pictures of one upload are fetched within this time. */
  fetchBudgetMs: 40_000,
  /** Uploads one workspace keeps, and adds in an hour. */
  perWorkspace: 100,
  perHour: 20
} as const

export const acceptedDesignFiles = '.html,.htm,.eml,text/html,message/rfc822'

/** The file's kind from its name (its content is checked on the server). */
export function designFileKind(name: string): 'html' | 'eml' | null {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(name.trim())?.[1]?.toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'eml') return 'eml'
  return null
}

/** The choice, in the owner's words. */
export const designWords: Record<UploadDesign, string> = {
  own: 'This is my brand’s own design',
  other: 'This is another brand’s email'
}

/** What each choice means, one line. */
export const designMeans: Record<UploadDesign, string> = {
  own: 'GROS keeps its layout, colours, fonts and pictures, and writes new words, products, prices, links and codes.',
  other:
    'GROS copies only its layout, in your colours, fonts, logo, words and photos. Nothing of the other brand is used.'
}

/** Why an upload was refused, in plain words. */
export function uploadRefusal(code: string | null | undefined): string {
  switch (code) {
    case 'unsupported_type':
      return 'This file type is not supported. Upload one email saved as .html, .htm or .eml.'
    case 'not_an_email':
      return 'This .eml file does not look like an email. If it is a web page, save it as .html and upload that.'
    case 'mbox_unsupported':
      return 'This looks like a mailbox with many emails. Export one email as .eml and upload that.'
    case 'rename_to_eml':
      return 'This file looks like a saved email. Rename it to end in .eml and upload it again.'
    case 'malformed':
    case 'limits_exceeded':
      return 'This email file could not be read. Export it again from your email app and try again.'
    case 'too_large':
      return 'This file is larger than 4 MB. Export the email without attachments and try again.'
    case 'content_too_large':
    case 'too_large_to_measure':
      return 'This email is too large to copy. Try a shorter email.'
    case 'unsupported_charset':
    case 'ambiguous_encoding':
      return 'This email’s text could not be read. Save it as UTF-8 and try again.'
    case 'no_content':
      return 'This file has no email in it. Choose another file.'
    case 'no_html':
      return 'This email has words only, no design. Upload an email with its design (HTML).'
    case 'upload_limit':
      return 'You have 100 emails of your own, the most. Delete one to add another.'
    case 'upload_hourly_limit':
      return 'You added many emails in the last hour. Try again later.'
    case 'upload_request_used':
      return 'This form was used for another file. Open the page again and choose the file.'
    case 'not_allowed':
      return 'Only the owner or an admin of this workspace can add emails.'
    default:
      return 'The email was not added. Try again in a minute.'
  }
}

/** Why an upload could not be measured, in plain words (`email_uploads.failure`). */
export const measureFailures: Record<string, string> = {
  too_large: 'The email is too large to measure (over 2 MB).',
  too_tall: 'The email is taller than 16,000 px, the most GROS can copy.',
  too_many_parts: 'The email has too many parts to copy.',
  navigated: 'The email tried to open another page, so it was not copied.',
  no_sections: 'GROS found no sections in this email.',
  not_valid: 'GROS could not read this email’s design.',
  stored_too_large: 'This email’s design is too large to keep.',
  not_bare:
    'This email still held a picture or a link of the other brand, so it was not kept.',
  measure_job_failed: 'GROS could not read this email’s design after 4 tries.'
}

export const measureFailure = (code: string | null) =>
  (code && measureFailures[code]) ?? 'GROS could not read this email’s design.'
