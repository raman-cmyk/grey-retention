import { picturePlaceholder } from './prepare'

/**
 * DES-ENGINE-003b: an own design's copy with each of its stored pictures'
 * placeholders (`https://email-uploads.invalid/<n>.<ext>`) replaced by
 * the picture's link (signed by the app), so Klaviyo can import it (rule
 * 11). A placeholder with no link stays, and the caller refuses the copy.
 */
const types = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export function withUploadPictures(
  html: string,
  links: ReadonlyMap<number, string>
) {
  let out = html
  for (const [index, url] of links)
    for (const type of types)
      out = out.split(picturePlaceholder(index, type)).join(url)
  return out
}

/** A placeholder still in the HTML: a picture that has no link. */
export const uploadPlaceholderLeft = /https:\/\/email-uploads\.invalid\//
