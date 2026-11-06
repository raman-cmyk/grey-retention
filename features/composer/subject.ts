import 'server-only'
import { cleanText, htmlTitle } from '@/features/email-import/parse'
import { pastedLimits, pastedReadable } from '@/features/references/pasted'

/**
 * A subject for a pasted email: the HTML <title> when there is one, else the
 * first readable line. Entities are decoded, control/invisible characters
 * removed and the result clipped to the subject limit without splitting an
 * emoji. Only the first 20,000 characters are scanned, so this stays linear
 * on untrusted input. Callers must check the body length first.
 */
export function subjectFromPaste(body: string) {
  const fromTitle = cleanText(htmlTitle(body), pastedLimits.subject).value
  if (fromTitle) return fromTitle
  const firstLine = pastedReadable(body.slice(0, 20_000))
    .text.split('\n')
    .map(
      (line) =>
        cleanText(line.replace(/^[•\s]+/, ''), pastedLimits.subject).value
    )
    .find(Boolean)
  return firstLine || 'Pasted email'
}
