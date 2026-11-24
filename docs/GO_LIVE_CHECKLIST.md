# Go-live checklist: the first real brand

For Raman. Plain steps to move GROS from sample data to one real brand. Do them in order. After each Vercel change, open **Admin → Operations → Go-live switches** (https://grey-retention-app.vercel.app/admin/operations) and check that the line says **On**. That panel shows the live app's real settings, never their values.

Written 24 November 2026. What is built and what is not is at the end.

## 1. Before the brand: your settings (one time)

### 1a. A Gemini key with billing on

1. In Google AI Studio, open the project the key belongs to and turn **billing** on. A free key allows only 20 calls a day per model, about two emails.
2. Copy the API key. Never paste it into a chat.
3. In Vercel: the `grey-retention-app` project → **Settings → Environment Variables**. Set `GEMINI_API_KEY` for **Production** (replace the old value if there is one).
4. If `AI_DEFAULT_PROVIDER` is set to `fake` there, delete it: it forces the fake AI.
5. If `GEMINI_COPY_MODEL`, `GEMINI_REVIEW_MODEL` or `GEMINI_PLAN_MODEL` are set to a `gemini-2.5-flash` or `gemini-2.5-pro` model, delete them: Google retires those on 1 December 2026, and the app's defaults are already the replacements.
6. Redeploy (Vercel → Deployments → the newest → Redeploy), or merge any pull request.
7. Check: **Real AI** says On, with the models in use.

What it costs: the competitor-email labelling uses at most $0.50 a day; every brand's own AI work is charged to that brand's AI allowance in the app, which stops at its cap.

### 1b. Turn the switches on one at a time

Set each in Vercel (Production), redeploy, check the panel, then the next.

| Order | Setting                       | What it turns on                                                   | Risk                                   |
| ----- | ----------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| 1     | `SITE_READER_MODE=live`       | Onboarding reads the brand's real website and reviews              | Reads public pages only                |
| 2     | `KLAVIYO_MODE=live`           | The brand's real Klaviyo catalog, past emails and results are read | Read only                              |
| 3     | `EMAIL_BUILD_AGENTS=on`       | The AI team plans, writes and checks each email in "Create email"  | Paid AI, within the brand's allowance  |
| 4     | `DESIGN_STUDIO=on` (optional) | Designed emails drawn by the design studio                         | Paid AI; coded blocks are the fallback |
| 5     | `KLAVIYO_DRAFT_PUSH=live`     | A created email lands in the brand's Klaviyo as a **draft**        | Never scheduled or sent by GROS        |

### 1c. The background jobs (GitHub, not Vercel)

In GitHub: `raman-cmyk/grey-retention` → **Settings → Secrets and variables → Actions → Variables**. `SCHEDULED_JOBS_ENABLED` must be `true`. It runs:

- the onboarding readers every 15 minutes (site, catalog, Klaviyo history, reviews, then the Brand book and the Brand strategist);
- the Klaviyo results check every hour (and the learning right after it);
- the competitor inbox labelling every 15 minutes.

The app cannot see this setting; the Operations panel only reminds you of it.

## 2. The brand

### 2a. Account

The brand's owner (or you, for a brand you run) signs up at https://grey-retention-app.vercel.app/signup and confirms the email.

### 2b. Setup (https://grey-retention-app.vercel.app/setup)

1. **Klaviyo key.** In Klaviyo: **Settings → API keys → Create Private API Key**.
   - Read access: Accounts, Campaigns, Catalogs, Events, Flows, Lists, Metrics, Segments, Templates, Images.
   - Read/Write access: Campaigns, Segments, Templates, Images (for the drafts).
   - Paste the key into Setup. The app checks it and names any area that is missing; Klaviyo cannot change a key, so make a new one if it asks.
2. **Discounts.** The largest discount the brand allows, and its real discount codes. GROS never invents a code or goes over the maximum.
3. **Competitors.** Follow the suggested brands like this one (or hide them).
4. **Finish.**

### 2c. Wait for onboarding (about an hour)

The readers run every 15 minutes: the website, the catalog, what the brand sent before, and reviews. Then the Brand book is written, and with real AI the Brand strategist adds the strategy and the voice guide.

## 3. The first emails

1. **Plan next 15 days.** Check the plan reads like the brand.
2. **Create email** on one slot. It takes a few minutes.
3. Open the brand's Klaviyo → Campaigns → Drafts. The email is there as a draft. **Nothing is sent until someone schedules it in Klaviyo.**
4. Look at it on a phone too, then schedule it in Klaviyo if it is right.

## 4. After sending

- Results are read every hour for 3 days after a send (the Results page).
- Learning needs at least 3 sends of a kind of email: after that, do's and don'ts appear on the Learned page, and the planners and writers follow them.
- Admin → Operations shows the fallback log (where an agent gave up and what it did instead) and the model retirement watch.

## 5. What is built, and what is not (24 November 2026)

Built and merged: the AI team from onboarding to the Klaviyo draft, the Brand strategist and voice guide, learning from results, the model fix for 1 December.

Not proved live yet: no agent has run on a paid key, and no real Klaviyo account has been read or written. **The first brand is that test**: start with a brand you run, check every draft before scheduling, and tell Claude what looks wrong.

Not built or waiting for you:

- **Ads reader**: needs Meta's Ad Library API (an app and a token). Until then a real brand's ads are not read.
- **Image studio** (product cut-outs, smart crop, dark-mode pictures): needs an image service you choose.
- **Screens that need a design first**: the Brand book review page (#58), the weekly learning report (#74).
- **Learning from send times and offers**, and industry-wide rules: later parts.
