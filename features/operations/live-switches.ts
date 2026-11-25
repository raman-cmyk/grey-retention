import 'server-only'
import { aiSetup } from '@/features/ai/setup'
import { emailAgentsOn } from '@/features/email-build/agents'
import { draftPushLive } from '@/features/klaviyo-push/live'
import { klaviyoMode } from '@/features/connections/live-klaviyo'
import { designStudioOn } from '@/features/studio/waits'
import { libraryCopyOn } from '@/features/email-build/library-copy'
import { inboxConfig } from '@/features/inbox/config'
import { klaviyoWritesUnlocked } from '@/lib/env/server'
import { strategyAgentsOn } from '@/features/strategy/agents'

type Env = Record<string, string | undefined>

/** One live switch as the admin Operations page shows it. */
export type LiveSwitch = {
  label: string
  /** on: live; off: fake or sample; attention: set, but it cannot work. */
  state: 'on' | 'off' | 'attention'
  /** What it does now and, when off, what turns it on. Never a value. */
  detail: string
}

/**
 * OPS-LIVE: the switches that make GROS work on a real brand, as this
 * server sees them (the live app's Vercel settings), in plain words for
 * the owner. Read from the same helpers the app uses, so the page says
 * what the app does. Never shows a key or a setting's value: only whether
 * it is set. `SCHEDULED_JOBS_ENABLED` is a GitHub setting the app cannot
 * read, so it is named, not judged.
 */
export function liveSwitches(env: Env = process.env): LiveSwitch[] {
  const copy = aiSetup('copy', env as NodeJS.ProcessEnv)
  const plan = aiSetup('plan', env as NodeJS.ProcessEnv)
  const live = copy.provider !== 'fake' && copy.ready
  const model = (s: typeof copy) => ('model' in s ? s.model : '?')
  const ai: LiveSwitch = live
    ? {
        label: 'Real AI',
        state: 'on',
        detail: `On: ${copy.provider === 'gemini' ? 'Gemini' : 'OpenAI'} (writing ${model(copy)}, planning ${model(plan)}). Paid, within each brand’s AI allowance.`
      }
    : !copy.ready
      ? {
          label: 'Real AI',
          state: 'attention',
          detail:
            'A model is set that the app has no price for, so AI calls are refused. Set GEMINI_COPY_MODEL and the others to models in the price table, or remove them.'
        }
      : {
          label: 'Real AI',
          state: 'off',
          detail:
            'reason' in copy && copy.reason === 'fake_selected'
              ? 'Off: AI_DEFAULT_PROVIDER=fake forces the fake AI. Remove it to use the real key.'
              : 'Off: no GEMINI_API_KEY, so every agent uses the fake AI. Add a key with billing on.'
        }
  const agents = emailAgentsOn(env as NodeJS.ProcessEnv)
  const studio = designStudioOn(env)
  const inbox = inboxConfig(env)
  const draftsAsked = env.KLAVIYO_DRAFT_PUSH === 'live'
  const planning = strategyAgentsOn(env as NodeJS.ProcessEnv)
  const review = aiSetup('review', env as NodeJS.ProcessEnv)
  const planLive = [plan, review].every((s) => s.provider !== 'fake' && s.ready)
  const planLabel = 'AI team in “Plan next 15 days”'
  return [
    ai,
    agents && live
      ? {
          label: 'AI team in “Create email”',
          state: 'on',
          detail: 'On: the agents plan, write and check each email.'
        }
      : agents
        ? {
            label: 'AI team in “Create email”',
            state: 'attention',
            detail:
              'EMAIL_BUILD_AGENTS=on, but there is no real AI: emails are built by code only.'
          }
        : {
            label: 'AI team in “Create email”',
            state: 'off',
            detail:
              'Off: emails are built by code only. Set EMAIL_BUILD_AGENTS=on.'
          },
    // STR-LIVE-001: the same checks as `strategyAgentsFor`.
    planning && planLive && klaviyoMode(env) === 'live'
      ? {
          label: planLabel,
          state: 'on',
          detail:
            'On: the agents plan the 15 days from the brand’s real Klaviyo data.'
        }
      : planning
        ? {
            label: planLabel,
            state: 'attention',
            detail: planLive
              ? 'STRATEGY_AGENTS=on, but Klaviyo reading is off: plans are made by code only. Set KLAVIYO_MODE=live too.'
              : 'STRATEGY_AGENTS=on, but there is no real AI: plans are made by code only.'
          }
        : {
            label: planLabel,
            state: 'off',
            detail: 'Off: plans are made by code only. Set STRATEGY_AGENTS=on.'
          },
    studio && agents && live
      ? {
          label: 'Design studio',
          state: 'on',
          detail: 'On: designed emails are drawn by the design studio.'
        }
      : studio
        ? {
            label: 'Design studio',
            state: 'attention',
            detail:
              'DESIGN_STUDIO=on, but it needs the AI team and real AI too: coded blocks are used.'
          }
        : {
            label: 'Design studio',
            state: 'off',
            detail: 'Off: coded blocks only. Set DESIGN_STUDIO=on.'
          },
    // DES-ENGINE-002b2: Copy in "Use this design" copies the chosen design.
    libraryCopyOn(env)
      ? {
          label: 'Copy the chosen design',
          state: 'on',
          detail:
            'On: “Use this design” with Copy copies the chosen email’s design for the brand, section by section (the copying job runs where the scheduled jobs are on, SCHEDULED_JOBS_ENABLED).'
        }
      : {
          label: 'Copy the chosen design',
          state: 'off',
          detail:
            'Off: Copy follows the chosen email’s order with coded blocks. Set DESIGN_LIBRARY_COPY=on.'
        },
    klaviyoMode(env) === 'live'
      ? {
          label: 'Klaviyo reading',
          state: 'on',
          detail:
            'On: the brand’s real catalog, past emails and results are read.'
        }
      : {
          label: 'Klaviyo reading',
          state: 'off',
          detail:
            'Off: sample Klaviyo data, no real account is read. Set KLAVIYO_MODE=live.'
        },
    draftPushLive(env) && klaviyoWritesUnlocked(env)
      ? {
          label: 'Klaviyo drafts',
          state: 'on',
          detail:
            'On: a created email lands in the brand’s Klaviyo as a draft, never scheduled or sent.'
        }
      : draftPushLive(env)
        ? {
            label: 'Klaviyo drafts',
            state: 'attention',
            detail:
              'KLAVIYO_DRAFT_PUSH=live, but Klaviyo writing is locked (KLV-LOCK-001): no draft is written. Set KLAVIYO_WRITE_LOCK=unlocked only when the owner decides.'
          }
        : draftsAsked
          ? {
              label: 'Klaviyo drafts',
              state: 'attention',
              detail:
                'KLAVIYO_DRAFT_PUSH=live, but Klaviyo reading is off: no draft is written. Set KLAVIYO_MODE=live too.'
            }
          : {
              label: 'Klaviyo drafts',
              state: 'off',
              detail:
                'Off: sample drafts only. Set KLAVIYO_DRAFT_PUSH=live (with KLAVIYO_MODE=live).'
            },
    env.SITE_READER_MODE === 'live'
      ? {
          label: 'Website reading',
          state: 'on',
          detail: 'On: onboarding reads the brand’s real website and reviews.'
        }
      : {
          label: 'Website reading',
          state: 'off',
          detail:
            'Off: onboarding reads the sample site. Set SITE_READER_MODE=live.'
        },
    inbox.ready && inbox.transport.kind === 'gmail_imap'
      ? {
          label: 'Competitor inbox',
          state: 'on',
          detail: 'On: competitors’ newsletters are read from the Gmail inbox.'
        }
      : inbox.ready
        ? {
            label: 'Competitor inbox',
            state: 'off',
            detail:
              'Off: the sample inbox. Set INBOX_IMAP_USER and INBOX_IMAP_APP_PASSWORD.'
          }
        : {
            label: 'Competitor inbox',
            state: 'attention',
            detail: `Not working: ${inbox.reason}`
          },
    {
      label: 'Background jobs',
      state: 'off',
      detail:
        'Set in GitHub, not here: the repository variable SCHEDULED_JOBS_ENABLED=true runs reading, results and learning. The app cannot see it.'
    }
  ]
}
