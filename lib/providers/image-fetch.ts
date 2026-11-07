/**
 * Downloads one image an email links to (INB-002). The live fetcher reads
 * the public internet with strict limits; the fake one (for sample emails)
 * never touches the network.
 */

export type ImageFailure =
  /** The link answered with an error, or nothing usable. */
  | 'broken'
  /** Bigger than the limit. */
  | 'too_large'
  /** Not a PNG, JPEG, GIF or WebP (decided by its bytes). */
  | 'not_image'
  /** A link we never open: not http(s), an odd port, or a private address. */
  | 'blocked'
  | 'timeout'
  /** The email used up its total allowance. */
  | 'limit'

export type FetchedImage =
  | {
      ok: true
      bytes: Uint8Array
      /** Where the link ended after redirects, when the fetcher knows. */
      url?: string
    }
  | { ok: false; failure: ImageFailure }

export interface ImageFetcher {
  fetch(
    url: string,
    limits: { maxBytes: number; timeoutMs: number }
  ): Promise<FetchedImage>
}
