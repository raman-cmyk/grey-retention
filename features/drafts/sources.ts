/** A competitor email a draft can follow (its sections, never its words). */
export type DraftReference = {
  id: string
  subject: string
  safe_html: string
  received_at: string
}

/** An email the owner pasted or uploaded, offered as a starting point. */
export type ImportedDraftReference = {
  id: string
  subject: string
  readable_text: string
  source_description: string
  source_url: string | null
  structure: string[]
  created_at: string
}

/** The `source` the draft action reads for an email the owner added. */
export const importedSource = (id: string) => `imported:${id}`
