import 'server-only'
import { z } from 'zod'

const serverEnvironmentSchema = z.object({
  AUTH_MODE: z.enum(['supabase', 'demo']).default('supabase'),
  ADAPTER_MODE: z.enum(['fake', 'real']).default('fake'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  KLAVIYO_API_REVISION: z.string().default('2026-07-15'),
  AI_DEFAULT_PROVIDER: z.string().default('fake'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_LABEL_MODEL: z.string().optional(),
  GEMINI_COPY_MODEL: z.string().optional(),
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
