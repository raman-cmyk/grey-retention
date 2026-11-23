import 'server-only'
import { z } from 'zod'

const serverEnvironmentSchema = z.object({
  AUTH_MODE: z.enum(['supabase', 'demo']).default('supabase'),
  ADAPTER_MODE: z.enum(['fake', 'real']).default('fake'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  KLAVIYO_API_REVISION: z.string().default('2026-10-15'),
  // KLV-001: exactly `live` (the owner's decision, set in Vercel) checks
  // keys with Klaviyo; anything else, or nothing, is sample. Any value is
  // accepted so a typo never breaks other pages
  // (features/connections/live-klaviyo.ts).
  KLAVIYO_MODE: z.string().optional(),
  /** The owner's switch for writing drafts into Klaviyo (PSH-001): `live`, with KLAVIYO_MODE=live. */
  KLAVIYO_DRAFT_PUSH: z.string().optional(),
  /**
   * KLV-LOCK-001: the Klaviyo write lock, server-only (never NEXT_PUBLIC).
   * Locked unless exactly `unlocked`; it wins over KLAVIYO_MODE and
   * KLAVIYO_DRAFT_PUSH. Read at each request by `klaviyoWritesUnlocked`,
   * never from this cached parse (docs/KLAVIYO_WRITE_LOCK.md).
   */
  KLAVIYO_WRITE_LOCK: z.string().optional(),
  /** `on` lets "Create email" ask the AI agents (REL-AI part 2), with a live model; the owner's switch, off by default. */
  EMAIL_BUILD_AGENTS: z.string().optional(),
  /** `on` lets "Create email" design its heroes as pictures (DST-006, D25), with the agents on; the owner's switch, off by default. */
  DESIGN_STUDIO: z.string().optional(),
  /** `live` reads real brand websites (ONB-101); the owner's switch, off by default. */
  SITE_READER_MODE: z.string().optional(),
  AI_DEFAULT_PROVIDER: z.string().default('fake'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_LABEL_MODEL: z.string().optional(),
  GEMINI_COPY_MODEL: z.string().optional(),
  GEMINI_PLAN_MODEL: z.string().optional(),
  GEMINI_REVIEW_MODEL: z.string().optional(),
  GEMINI_TIMEOUT_MS: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  // Inspiration inbox (INB-001): read by features/inbox/config.ts, which
  // checks the values and never logs them. `fake` (default) or `gmail_imap`.
  INBOX_TRANSPORT: z.string().optional(),
  INBOX_IMAP_USER: z.string().optional(),
  INBOX_IMAP_APP_PASSWORD: z.string().optional()
})

let parsedEnvironment: z.infer<typeof serverEnvironmentSchema> | undefined

export function getServerEnvironment() {
  parsedEnvironment ??= serverEnvironmentSchema.parse(process.env)
  return parsedEnvironment
}

/**
 * KLV-LOCK-001: whether the server environment releases the Klaviyo write
 * lock: only `KLAVIYO_WRITE_LOCK` set to exactly `unlocked`. Missing,
 * empty, spaced, another case or any other word stays locked. Read from
 * the environment at every call (never cached), and nothing a caller
 * passes changes it. Only a separate, explicit owner instruction may set
 * it; connecting a full-access key is not that instruction.
 */
export function klaviyoWritesUnlocked(): boolean {
  return process.env.KLAVIYO_WRITE_LOCK === 'unlocked'
}
