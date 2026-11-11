/**
 * The Klaviyo draft port (EML-004 part 2, for PSH-001's live adapter):
 * puts one built email into the client's Klaviyo account as a DRAFT
 * campaign. Contract agreed with the supervisor (11 Nov):
 *
 * 1. It only ever creates a draft campaign: it never schedules or sends
 *    (D17: the owner schedules in Klaviyo).
 * 2. `idempotencyKey` is one per planned email (the build's push key): the
 *    same key again returns the same campaign id, never a second draft,
 *    and updates that draft to this input's content, so Klaviyo holds the
 *    email just built (a "Try again" after a push timed out may rebuild
 *    it). A campaign that is no longer a draft (the owner scheduled or
 *    sent it) is never changed: the answer is `rejected`.
 * 3. It never throws: failures come back as codes. `rate_limited` and
 *    `unavailable` are tried again later (with `retryAfterSeconds` when
 *    Klaviyo gives one); `auth` and `rejected` are final.
 * 4. A `sample` email (built from the sample store) never reaches a real
 *    Klaviyo account: a live adapter answers `rejected` for it.
 *
 * Before it creates the draft it uploads the pictures to Klaviyo (VISION
 * rule 11) and runs the launch check (QAG-001 `runReleaseQa`); a failed
 * check comes back as `rejected` with the failing check ids.
 */
export type DraftInput = {
  tenantId: string
  idempotencyKey: string
  /** The campaign's name in Klaviyo, e.g. "Tue 17 Nov · Offer". */
  name: string
  subject: string
  preheader: string
  html: string
  /** When the plan meant it to send, ISO with offset; the draft stays unscheduled. */
  plannedSendAt: string
  /** The plan's audience, by our id (lane B maps it to a Klaviyo segment). */
  audienceId: string
  /** Built from the sample store: never for a real Klaviyo account. */
  sample: boolean
  /**
   * An A/B design test (EML-005): exactly two, A first, with the same
   * subject, preheader and audience. They go into ONE draft campaign with
   * two variations sent to half the audience each and no winner picked
   * (the owner still schedules it). Without it the draft has `html` only.
   */
  variations?: { approach: 'A' | 'B'; html: string }[]
  /**
   * The build's push lease (PSH-001): the live pusher saves each step it
   * makes in Klaviyo under it, so a run that lost its lease saves nothing
   * and two runs never both make a draft. The fake ignores it.
   */
  lease?: { build: string; token: string }
}

export type DraftResult =
  | {
      ok: true
      campaignId: string
      sample: boolean
      /**
       * Which designs went in: both, or A only when Klaviyo refused an even
       * test (the draft then has one variation; alternate the designs
       * across emails instead). Absent when no variations were asked.
       */
      designs?: 'both' | 'A'
    }
  | {
      ok: false
      code: 'auth' | 'rate_limited' | 'unavailable' | 'rejected'
      retryAfterSeconds?: number
      /** For `rejected` by the launch check: the failing check ids. */
      checks?: string[]
    }

export interface DraftPusher {
  createDraft(input: DraftInput): Promise<DraftResult>
}

/** The fake pusher: no Klaviyo call; the same key gives the same id. */
export function fakeDraftPusher(): DraftPusher & { calls: DraftInput[] } {
  const calls: DraftInput[] = []
  return {
    calls,
    async createDraft(input) {
      calls.push(input)
      return {
        ok: true,
        campaignId: `sample-draft-${input.idempotencyKey}`,
        sample: true,
        ...(input.variations ? { designs: 'both' as const } : {})
      }
    }
  }
}
