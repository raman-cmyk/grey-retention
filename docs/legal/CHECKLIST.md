# Legal pages: what Raman must confirm

The Privacy Policy and Terms of Service are **drafts** (POLICY-DRAFT, `features/legal/drafts.ts`). They show only with `LEGAL_DRAFTS=on`, are never indexed and are **not linked from sign-up**. Each line below is a `[NEEDS RAMAN: …]` field on the pages. Nothing is published until every line is confirmed; an entity, address or promise that is not confirmed is never published.

## Both pages

1. **Confirm the legal entity and its registered address.** Not confirmed: no entity name or address is used anywhere until Raman confirms both.
2. The publication date (and, for the Terms, a version).

## Privacy Policy

3. The privacy contact email.
4. Whether a customer's name or initial may appear with a quoted review or photo, and how a customer asks for removal (the app keeps the reviewer's name as their page shows it, and the addresses of customers' review photos).
5. The signed data processing agreements, if any, with each provider: Supabase, Vercel, Google (Gemini and Gmail), OpenAI, Klaviyo, GitHub.
6. Whether any provider may use the data to train its models, as its agreement states.
7. How long each kind of data is kept, and what happens to it when an account or a workspace is deleted.
8. Which laws apply (for example GDPR, UK GDPR, CCPA), and how a person asks to see, correct or delete their data.
9. That no analytics or advertising tools are added (none were found in the code; the app's own cookies are sign-in, the current workspace and the side menu's state), or a list of them.

## Terms of Service

10. Prices, billing, trials and refunds, if any.
11. The limit of liability and the disclaimer wording.
12. How an account is closed, what is deleted, and on what notice an account may be suspended or ended.
13. The governing law, and where disputes are heard.

## Then

- A lawyer's review of both drafts (recommended, not done).
- Link both pages from sign-up and the site's footer, and remove `LEGAL_DRAFTS` (a code change after the OK).
