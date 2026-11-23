/**
 * POLICY-DRAFT: drafts of the Privacy Policy and the Terms, written from
 * what the app really does with data (its tables, storage, providers and
 * jobs), with every business fact not yet confirmed as a visible
 * `[NEEDS RAMAN: …]` field. Nothing here is invented: no retention
 * period, no promise about model training, no vendor agreement. They are
 * drafts: shown only with `LEGAL_DRAFTS=on`, never linked from sign-up,
 * until Raman confirms each field (docs/legal/CHECKLIST.md).
 */

import { defaultBrandPresentation } from '@/lib/branding/presentation'

const product = defaultBrandPresentation.productName

/** A field only Raman can fill, shown as it is. */
export const needs = (what: string) => `[NEEDS RAMAN: ${what}]`

/** Who runs the service: not confirmed (the first checklist item). */
export const operator = needs('confirm legal entity and registered address')

export type PolicySection = { heading: string; paragraphs: string[] }
export type PolicyDraft = {
  title: string
  /** Shown at the top of the page, always. */
  draftNotice: string
  sections: PolicySection[]
}

const draftNotice =
  'Draft for review. This page is not in force and is not linked from sign-up. Every [NEEDS RAMAN: …] field must be confirmed before it is published.'

export const privacyDraft: PolicyDraft = {
  title: 'Privacy Policy (draft)',
  draftNotice,
  sections: [
    {
      heading: 'Who we are',
      paragraphs: [
        `${product} is operated by ${operator}. Contact for privacy questions: ${needs('privacy contact email')}.`,
        `This policy was last updated on ${needs('publication date')}.`
      ]
    },
    {
      heading: 'What we keep',
      paragraphs: [
        'Your account: your email address, the name, job title and phone you add to your profile, your sign-in, the workspaces you belong to and your role in each, and invitations you send or receive.',
        'Your store, as you connect it: your Klaviyo key, kept encrypted and never shown again after you save it (a masked hint of its first and last characters stays to tell you which key it was); your Klaviyo account’s name, website, country, currency and time zone; what we read from Klaviyo with it (your lists and segments, campaigns, flows, the emails you sent and their results, and your catalog); your orders, read to count which products sell, of which we keep the counts, not the orders; and the email drafts, templates and pictures we put into your Klaviyo account. Nothing is ever sent or scheduled from your account by us: drafts wait for you.',
        'What we learn about your brand: what our readers find on your own website and public pages (your logo, fonts, colours, photos, product facts and customer reviews), the brand book made from them, and the corrections you make to it.',
        'Your settings and plans: your maximum discount and discount codes, revenue goal, holidays, the 15-day plans and the emails made from them, the rules learned from results, and a record of who changed your discount, codes, Klaviyo connection or team.',
        'How the AI team worked: each run’s steps, the reasons when something fell back to a safer choice, and how much AI each workspace used (counts and costs, for the usage caps).',
        'What you send us: your messages to GROS (the app’s AI chat), your support and feature requests, the files you upload (pictures and zip files) and the email files you import.',
        'Inspiration emails: marketing emails from other brands that arrive in our shared inspiration inbox, the pictures in them and what our readers note about their layout. These are other companies’ public newsletters, not your customers’ data.'
      ]
    },
    {
      heading: 'Your customers’ data',
      paragraphs: [
        'We do not copy your subscriber list. Emails are built for your Klaviyo lists and segments, chosen by their names; Klaviyo sends them, to the people you chose, when you schedule them. Results we read back are totals per email and per link (people reached, opens, clicks, orders, revenue), not a list of who opened.',
        'From your public review pages we keep the reviews worth quoting, with the reviewer’s name as the page shows it, and the addresses of photos customers posted with their reviews (at most 12 a read).',
        `${needs('whether a customer’s name or initial may appear with a quoted review or photo, and how a customer asks for removal')}`
      ]
    },
    {
      heading: 'Who processes it for us',
      paragraphs: [
        'Supabase: our database, sign-in and private file storage.',
        'Vercel: hosts the app and runs its background jobs.',
        'Google (Gemini): the AI that reads, plans, writes and checks, when it is switched on. What we send it: your brand’s material, the text of your customers’ reviews (without their names), the emails your store sent before, the email being made, and other brands’ newsletters from the inspiration inbox (to label their layouts).',
        'OpenAI: a second AI provider, off unless switched on, and the older email-rewriting tool when a workspace uses it.',
        'Klaviyo: your own account, through the key you give us.',
        'Google (Gmail): the shared inbox where inspiration emails arrive.',
        `GitHub: runs scheduled jobs that draw pictures of emails in a browser: designed sections of your emails and other brands’ inspiration emails. ${needs('list of signed data processing agreements, if any, with each provider above')}`,
        `${needs('whether any provider may use the data to train its models, as stated in the agreement we have with it')}`
      ]
    },
    {
      heading: 'How long we keep it',
      paragraphs: [
        `${needs('how long each kind of data is kept, and what happens to it when an account or a workspace is deleted')}`
      ]
    },
    {
      heading: 'Your rights',
      paragraphs: [
        `${needs('which laws apply (for example GDPR, UK GDPR, CCPA) and how a person asks to see, correct or delete their data')}`,
        'You can disconnect Klaviyo at any time in Settings: we then stop reading from it and delete the key we keep (it still works in Klaviyo until you delete it there). Drafts, templates and pictures already in Klaviyo stay in your account.'
      ]
    },
    {
      heading: 'Cookies',
      paragraphs: [
        `We use cookies that the app needs: to keep you signed in, to remember which workspace you are in, and to remember whether you folded the side menu (kept for a year). We found no analytics or advertising cookies in the app. ${needs('confirm no analytics or advertising tools are added, or list them')}`
      ]
    }
  ]
}

export const termsDraft: PolicyDraft = {
  title: 'Terms of Service (draft)',
  draftNotice,
  sections: [
    {
      heading: 'The service',
      paragraphs: [
        `${product} is provided by ${operator}. By creating an account you agree to these terms. ${needs('publication date and the version of these terms')}`,
        `${product} plans and makes marketing emails for your store and puts them into your own Klaviyo account as drafts. You decide what is scheduled and sent; we never send or schedule an email for you.`
      ]
    },
    {
      heading: 'Your account and your store',
      paragraphs: [
        'You are responsible for the store you connect and for the Klaviyo key you give us, and for having the right to use your brand’s material, products and customer reviews in your emails.',
        'You check each draft before you schedule it: its words, offers, prices and codes. The app checks them too (your maximum discount, real codes, unsubscribe link, spam and accessibility checks), but the email you send is yours.'
      ]
    },
    {
      heading: 'Inspiration from other brands',
      paragraphs: [
        'The app learns layouts from other brands’ public marketing emails. It is built not to copy another brand’s words, logo, products or photos into your email, and checks for another brand’s logo in its designs; check each draft as you would any email.'
      ]
    },
    {
      heading: 'Fees',
      paragraphs: [`${needs('prices, billing, trials and refunds, if any')}`]
    },
    {
      heading: 'AI and its limits',
      paragraphs: [
        'Parts of the work are done by AI models. They can make mistakes; every email is checked by code before it reaches your Klaviyo account, and is made again in a safer way, or not sent to Klaviyo at all, when a check fails.',
        `${needs('limit of liability and disclaimer wording')}`
      ]
    },
    {
      heading: 'Ending the service',
      paragraphs: [
        `You can disconnect Klaviyo at any time. ${needs('how an account is closed, what is deleted, and on what notice we may suspend or end an account')}`
      ]
    },
    {
      heading: 'Law and disputes',
      paragraphs: [`${needs('governing law and where disputes are heard')}`]
    }
  ]
}

/** The drafts are shown only with the owner's switch on. */
export const legalDraftsOn = (env: NodeJS.ProcessEnv = process.env) =>
  env.LEGAL_DRAFTS?.trim() === 'on'

/** Every field still needed, in page order (the checklist lists them). */
export function missingFields(draft: PolicyDraft) {
  return draft.sections.flatMap((s) =>
    s.paragraphs.flatMap((p) =>
      [...p.matchAll(/\[NEEDS RAMAN: ([^\]]+)\]/g)].map((m) => m[1]!)
    )
  )
}
