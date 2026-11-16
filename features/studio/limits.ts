/**
 * The design studio's limits and its one shared refusal, outside the
 * server-only modules so the rounds (DST-006c) and the build steps can use
 * them anywhere.
 */

/**
 * The database's limits (`wait_email_round`, `request_section_render`),
 * repeated here: the database refuses past them whatever these say.
 */
export const studioWaits = {
  minSeconds: 60,
  maxSeconds: 3_600,
  /** Waits per design step: the studio's rounds are 3 at most. */
  perStep: 6,
  /** Pictures per build. */
  renders: 12,
  /** The email's views per build (DST-005b: three views of three versions). */
  views: 9
}

/** A section that cannot be drawn: the caller's mistake, never queued. */
export class SectionNotDrawable extends Error {
  constructor(readonly problems: string[]) {
    super('A section that cannot be drawn is never queued')
  }
}
