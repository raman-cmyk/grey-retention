# Inbox pilot: the first newsletter sign-ups

**Status: a plan only** (INB-PILOT, 20 November 2026). Nobody has signed up to anything and nothing was sent. Raman chooses the first industry, gives the OK, and confirms who does the sign-ups. No live provider is switched on by this plan.

This answers owner pick #45, "Grow the inbox fast" (`docs/AGENT_MAP.md`, the line for #45; Blocked in `docs/BUILD_LEDGER.md`). The emails that arrive already flow through INB-001 to INB-004. This page says which brands to sign up first, how, how fast, how we check what arrives, and when we stop.

**In short**

- 62 public brands in 8 approved industries, each with its own plus-address. Checked on 20 November 2026.
- Proposed first industry: **skincare**. Raman picks.
- A person signs up by hand, from the inbox account, after Raman's OK. At most 3 brands a day.
- What arrives is checked with what INB-001 to INB-004 already built (the admin page `/admin/inbox`).
- A stop rule pauses everything. Only Raman restarts it.

## 1. Industries

The approved niches are the ten Raman named in decision **D7** (`docs/BUILD_BRIEF.md`, line 34): "Pre-subscribe ~10 niches now (skincare, supplements, jewelry, pet, home, apparel, fitness, beauty tools, baby, kitchen)."

Each of the ten is also a value on the fixed industry list in the code, `industries` in `features/intelligence/taxonomy.ts` (lines 12 to 31), which the database checks too (`supabase/migrations/20260914090050_competitor_tags.sql`, lines 40 and 41). When an admin types the niche word into the brand directory, `industryOf` (`features/intelligence/classifier.ts`, lines 48 to 73) turns it into that value. That is how the inbox's brands are matched to a store of the same industry (ONB-065a, REAL-01a). The new test `features/inbox/arrivals.test.ts` checks all ten words.

| Niche word to type (D7) | Industry value | Line in `taxonomy.ts` | Brands in this list    |
| ----------------------- | -------------- | --------------------- | ---------------------- |
| skincare                | `skincare`     | 16                    | 8                      |
| supplements             | `supplements`  | 20                    | 0 (held back, see 2.9) |
| jewelry                 | `jewelry`      | 15                    | 8                      |
| pet                     | `pet`          | 26                    | 7                      |
| home                    | `home`         | 25                    | 9                      |
| apparel                 | `apparel`      | 13                    | 8                      |
| fitness                 | `fitness`      | 22                    | 8                      |
| beauty tools            | `beauty_tools` | 18                    | 5                      |
| baby                    | `baby`         | 27                    | 0 (held back, see 2.9) |
| kitchen                 | `kitchen`      | 24                    | 9                      |

No other industry is used. The code list has more values (accessories, beauty, haircare, wellness, food and drink, outdoor, electronics), but D7 did not approve them for this pilot.

## 2. The vetted first list

**How the brands were picked.** Well-known public consumer brands that sell online from their own website (direct to consumer) and offer a public email newsletter. At most 10 per industry. No individuals or creators. No adult, gambling, alcohol, tobacco or weapons brands. No brands whose main products are sold on health claims, and none aimed at children. Brands of the stores Grey Retention serves are never on this list.

**How they were checked.** Web search on **20 November 2026**. This session could not open the websites directly (its network does not allow them), so each brand was checked through search results. A brand is listed only when the results showed both:

1. **its own website**, selling online (a page on its own domain, or its sent emails filed under that domain on a public email archive); and
2. **a public newsletter**: a sign-up offer on its own site (marked "sign-up on its site" below), or its marketing emails kept on a public email archive (marked "emails archived").

Anything that could not be checked this way was dropped (see 2.10). Offers and forms change, so the person signing up checks again on the day.

All of these are large, well-known brands. VISION asks for competitors "of similar size" to our stores. Big brands come first because they are easy to check and send often. Later rounds add smaller brands of the same industries.

The **plus-address** column uses placeholders. `<inbox-local>` and `<inbox-domain>` are the two halves of the inbox's own address, which comes from configuration and is never written in this repository (see section 3).

### 2.1 Skincare (8)

| Brand          | Website           | Why it fits                                                 | Plus-address                                  |
| -------------- | ----------------- | ----------------------------------------------------------- | --------------------------------------------- |
| Glossier       | glossier.com      | DTC skincare and beauty; sign-up on its site (help pages)   | `<inbox-local>+glossier@<inbox-domain>`       |
| Glow Recipe    | glowrecipe.com    | DTC skincare; emails archived                               | `<inbox-local>+glow-recipe@<inbox-domain>`    |
| Tatcha         | tatcha.com        | DTC skincare; sign-up on its site ("new to Tatcha" page)    | `<inbox-local>+tatcha@<inbox-domain>`         |
| Cocokind       | cocokind.com      | DTC skincare; its site asks visitors to join the newsletter | `<inbox-local>+cocokind@<inbox-domain>`       |
| Biossance      | biossance.com     | DTC skincare; emails archived                               | `<inbox-local>+biossance@<inbox-domain>`      |
| Drunk Elephant | drunkelephant.com | DTC skincare; sign-up on its site (homepage and footer)     | `<inbox-local>+drunk-elephant@<inbox-domain>` |
| Kiehl's        | kiehls.com        | Skincare sold on its own US site; emails archived           | `<inbox-local>+kiehls@<inbox-domain>`         |
| Peach & Lily   | peachandlily.com  | DTC skincare; emails archived                               | `<inbox-local>+peach-and-lily@<inbox-domain>` |

### 2.2 Jewelry (8)

| Brand           | Website            | Why it fits                                                   | Plus-address                                   |
| --------------- | ------------------ | ------------------------------------------------------------- | ---------------------------------------------- |
| Mejuri          | mejuri.com         | DTC fine jewelry; sign-up on its site                         | `<inbox-local>+mejuri@<inbox-domain>`          |
| Kendra Scott    | kendrascott.com    | Jewelry sold on its own site; its privacy page names the list | `<inbox-local>+kendra-scott@<inbox-domain>`    |
| Missoma         | missoma.com        | DTC demi-fine jewelry; emails archived                        | `<inbox-local>+missoma@<inbox-domain>`         |
| gorjana         | gorjana.com        | DTC jewelry; emails archived                                  | `<inbox-local>+gorjana@<inbox-domain>`         |
| Ana Luisa       | analuisa.com       | DTC jewelry; emails archived                                  | `<inbox-local>+ana-luisa@<inbox-domain>`       |
| AUrate          | auratenewyork.com  | DTC gold jewelry; emails archived                             | `<inbox-local>+aurate@<inbox-domain>`          |
| Astrid & Miyu   | astridandmiyu.com  | DTC jewelry; its help pages point to the newsletter sign-up   | `<inbox-local>+astrid-and-miyu@<inbox-domain>` |
| Brilliant Earth | brilliantearth.com | DTC fine jewelry; emails archived                             | `<inbox-local>+brilliant-earth@<inbox-domain>` |

### 2.3 Apparel (8)

| Brand         | Website            | Why it fits                                                        | Plus-address                                 |
| ------------- | ------------------ | ------------------------------------------------------------------ | -------------------------------------------- |
| Everlane      | everlane.com       | DTC clothing; sign-up on its site ("new to Everlane" page)         | `<inbox-local>+everlane@<inbox-domain>`      |
| Reformation   | thereformation.com | DTC clothing; sign-up in its footer; emails archived               | `<inbox-local>+reformation@<inbox-domain>`   |
| Quince        | quince.com         | DTC clothing and home; emails archived                             | `<inbox-local>+quince@<inbox-domain>`        |
| Taylor Stitch | taylorstitch.com   | DTC menswear; its site has terms for email-only offers             | `<inbox-local>+taylor-stitch@<inbox-domain>` |
| Outerknown    | outerknown.com     | DTC clothing; emails archived                                      | `<inbox-local>+outerknown@<inbox-domain>`    |
| Faherty       | fahertybrand.com   | DTC clothing; emails archived                                      | `<inbox-local>+faherty@<inbox-domain>`       |
| Allbirds      | allbirds.com       | DTC shoes and clothing; sign-up page on its site ("stay in touch") | `<inbox-local>+allbirds@<inbox-domain>`      |
| Bombas        | bombas.com         | DTC socks and basics; emails archived                              | `<inbox-local>+bombas@<inbox-domain>`        |

### 2.4 Home (9)

| Brand            | Website            | Why it fits                                                 | Plus-address                                    |
| ---------------- | ------------------ | ----------------------------------------------------------- | ----------------------------------------------- |
| Parachute        | parachutehome.com  | DTC bedding and bath; emails archived                       | `<inbox-local>+parachute@<inbox-domain>`        |
| Brooklinen       | brooklinen.com     | DTC bedding; welcome email recorded by an email archive     | `<inbox-local>+brooklinen@<inbox-domain>`       |
| Boll & Branch    | bollandbranch.com  | DTC bedding; emails archived                                | `<inbox-local>+boll-and-branch@<inbox-domain>`  |
| Ruggable         | ruggable.com       | DTC rugs; sign-up on its site (its FAQ)                     | `<inbox-local>+ruggable@<inbox-domain>`         |
| Burrow           | burrow.com         | DTC furniture; emails archived                              | `<inbox-local>+burrow@<inbox-domain>`           |
| Floyd            | floydhome.com      | DTC furniture; emails archived                              | `<inbox-local>+floyd@<inbox-domain>`            |
| Lulu and Georgia | luluandgeorgia.com | DTC home decor; emails archived                             | `<inbox-local>+lulu-and-georgia@<inbox-domain>` |
| Otherland        | otherland.com      | DTC candles; its help page points to email; emails archived | `<inbox-local>+otherland@<inbox-domain>`        |
| Coyuchi          | coyuchi.com        | DTC organic bedding; sign-up on its site (contact page)     | `<inbox-local>+coyuchi@<inbox-domain>`          |

### 2.5 Fitness (8)

| Brand                 | Website           | Why it fits                                                    | Plus-address                                         |
| --------------------- | ----------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| Gymshark              | gymshark.com      | DTC gym wear; newsletter page on its site                      | `<inbox-local>+gymshark@<inbox-domain>`              |
| Alo Yoga              | aloyoga.com       | DTC yoga wear; newsletter page on its site                     | `<inbox-local>+alo-yoga@<inbox-domain>`              |
| Vuori                 | vuoriclothing.com | DTC activewear; sign-up page on its site                       | `<inbox-local>+vuori@<inbox-domain>`                 |
| Girlfriend Collective | girlfriend.com    | DTC activewear; emails archived                                | `<inbox-local>+girlfriend-collective@<inbox-domain>` |
| Manduka               | manduka.com       | DTC yoga mats and gear; its help pages describe the email list | `<inbox-local>+manduka@<inbox-domain>`               |
| Ten Thousand          | tenthousand.cc    | DTC training wear; its newsletter is archived                  | `<inbox-local>+ten-thousand@<inbox-domain>`          |
| Rogue Fitness         | roguefitness.com  | Gym equipment sold on its own site; newsletter sign-up there   | `<inbox-local>+rogue-fitness@<inbox-domain>`         |
| Tracksmith            | tracksmith.com    | DTC running wear; newsletter page on its site                  | `<inbox-local>+tracksmith@<inbox-domain>`            |

### 2.6 Kitchen (9)

| Brand       | Website             | Why it fits                                                  | Plus-address                                    |
| ----------- | ------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Our Place   | fromourplace.com    | DTC cookware; its monthly newsletter is archived             | `<inbox-local>+our-place@<inbox-domain>`        |
| Caraway     | carawayhome.com     | DTC cookware; emails archived                                | `<inbox-local>+caraway@<inbox-domain>`          |
| Made In     | madeincookware.com  | DTC cookware; sign-up on its site                            | `<inbox-local>+made-in@<inbox-domain>`          |
| Great Jones | greatjonesgoods.com | DTC cookware; emails archived                                | `<inbox-local>+great-jones@<inbox-domain>`      |
| HexClad     | hexclad.com         | DTC cookware; its site asks visitors to join the newsletter  | `<inbox-local>+hexclad@<inbox-domain>`          |
| Material    | materialkitchen.com | DTC kitchen tools; emails archived                           | `<inbox-local>+material-kitchen@<inbox-domain>` |
| Fellow      | fellowproducts.com  | DTC coffee gear; its offers page describes the email sign-up | `<inbox-local>+fellow@<inbox-domain>`           |
| Misen       | misen.com           | DTC cookware; its help pages point to the footer sign-up     | `<inbox-local>+misen@<inbox-domain>`            |
| Le Creuset  | lecreuset.com       | Cookware sold on its own US site; its FAQ says sign up there | `<inbox-local>+le-creuset@<inbox-domain>`       |

### 2.7 Pet (7)

| Brand      | Website       | Why it fits                                                           | Plus-address                               |
| ---------- | ------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| Wild One   | wildone.com   | DTC dog gear; its site asks visitors to sign up for updates           | `<inbox-local>+wild-one@<inbox-domain>`    |
| Ruffwear   | ruffwear.com  | Dog gear sold on its own site; emails archived                        | `<inbox-local>+ruffwear@<inbox-domain>`    |
| Fable      | fablepets.com | DTC dog gear and crates; its welcome email is archived                | `<inbox-local>+fable-pets@<inbox-domain>`  |
| BARK       | bark.co       | DTC dog toys and boxes; its blog asks visitors to join the newsletter | `<inbox-local>+bark@<inbox-domain>`        |
| Lucy & Co. | lucyand.co    | DTC dog collars and leashes; "Join our email list" on its site        | `<inbox-local>+lucy-and-co@<inbox-domain>` |
| Diggs      | diggs.pet     | DTC dog crates; "Sign up for our newsletter" on its site              | `<inbox-local>+diggs@<inbox-domain>`       |
| Zee.Dog    | zeedog.com    | DTC dog gear; sign-up prompt on its site                              | `<inbox-local>+zee-dog@<inbox-domain>`     |

### 2.8 Beauty tools (5)

| Brand         | Website           | Why it fits                                                                | Plus-address                                 |
| ------------- | ----------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| ghd           | ghdhair.com       | Hair tools sold on its own US store; its pages ask for newsletter sign-ups | `<inbox-local>+ghd@<inbox-domain>`           |
| Drybar        | drybar.com        | Hair tools sold on its own site; its privacy page names the list           | `<inbox-local>+drybar@<inbox-domain>`        |
| Tweezerman    | tweezerman.com    | Beauty tools sold on its own site; sign-up prompt there                    | `<inbox-local>+tweezerman@<inbox-domain>`    |
| beautyblender | beautyblender.com | Makeup tools sold on its own site; emails archived                         | `<inbox-local>+beautyblender@<inbox-domain>` |
| Sigma Beauty  | sigmabeauty.com   | DTC makeup brushes; its help pages point to the sign-up box                | `<inbox-local>+sigma-beauty@<inbox-domain>`  |

### 2.9 Held back: supplements and baby

Both are approved niches (D7), but this pilot's rules keep them out until Raman decides:

- **Supplements:** supplement brands sell on health claims, which this pilot excludes. No brand was listed.
- **Baby:** baby products are for children, and this pilot excludes brands aimed at children. Brands that sell to parents (nursery furniture, prams) could be a later list if Raman says they are fine. No brand was listed.

### 2.10 Checked and dropped

| Industry     | Brand                | Why it was dropped                                                             |
| ------------ | -------------------- | ------------------------------------------------------------------------------ |
| Skincare     | Summer Fridays       | Only a loyalty-account page and third-party guides showed for the newsletter   |
| Skincare     | Youth To The People  | Its own website did not show in the results                                    |
| Skincare     | Herbivore Botanicals | Its own website did not show in the results                                    |
| Skincare     | OSEA                 | No newsletter found                                                            |
| Skincare     | Nécessaire           | Sells a sexual-wellness product (adult)                                        |
| Skincare     | Farmacy              | Its sign-up form also opts in to emails from its parent company's other brands |
| Jewelry      | Catbird              | Its own website did not show in the results                                    |
| Jewelry      | Monica Vinader       | Its own website did not show in the results                                    |
| Apparel      | Pact                 | Newsletter only described by coupon sites                                      |
| Apparel      | Marine Layer         | Its own website did not show in the results                                    |
| Fitness      | Outdoor Voices       | Its own website did not show in the results                                    |
| Fitness      | Rhone                | Not found                                                                      |
| Fitness      | Bala                 | Newsletter only described by coupon sites                                      |
| Fitness      | Beyond Yoga          | Not found                                                                      |
| Home         | Article              | No newsletter found                                                            |
| Home         | Schoolhouse          | Only a text-message (SMS) sign-up found                                        |
| Pet          | Kurgo                | Newsletter only described by coupon sites                                      |
| Pet          | Maxbone              | Now mainly dog food; no newsletter found                                       |
| Pet          | West Paw             | No newsletter found                                                            |
| Pet          | Earth Rated          | Not found                                                                      |
| Pet          | Fi                   | Sells pet health tracking; no sign-up found                                    |
| Pet          | Harry Barker         | Not found                                                                      |
| Beauty tools | T3                   | Its own website did not show in the results                                    |
| Beauty tools | L'ange Hair          | Its own website did not show in the results                                    |
| Beauty tools | Tangle Teezer        | Only an account sign-up found                                                  |
| Beauty tools | Bio Ionic            | Newsletter only described by coupon sites                                      |
| Beauty tools | Mount Lai            | Only a guide or quiz sign-up found                                             |

Left out before checking: brands whose main products carry health or drug claims (sunscreen, acne treatment, skin devices sold on medical claims, pet food and pet supplements).

### 2.11 Notes for the day of sign-up

- **Gymshark**'s newsletter page asks for a date of birth, **Kendra Scott** may ask for a ZIP code and **Diggs** for the dog's name and birthday. Leave them empty. If the form refuses to send without them, skip the brand.
- **Mejuri**, **Tweezerman** and **Sigma Beauty** also have account or loyalty sign-ups. Use the newsletter box only, never an account.
- **BARK** sells subscription boxes and **Fellow** a text-message coffee program. Join the email newsletter only.
- **Glow Recipe:** one email archive saw only an account email after signing up. Check that the form is a newsletter box, not an account.
- **Sender domains to add** besides the brand's own domain (from the search results): Misen's archived emails come from `misen.co`, so add `misen.co`; Quince's contact addresses use `onequince.com`, so add `onequince.com`; BARK's shop is `bark.co` and its box is still called BarkBox (`barkbox.com`), so add `barkbox.com`. Subdomains of the brand's own domain (`e.`, `mail.`, `news.`) need nothing extra.

## 3. Plus-addresses

Every brand gets one address: `<inbox-local>+<slug>@<inbox-domain>`.

- **The base address is never in this repository.** It comes from the server setting `INBOX_IMAP_USER` (`features/inbox/config.ts`, `inboxConfig`, line 34; split into its two halves in `features/inbox/imap.ts`, lines 85 to 93). The admin brand directory at `/admin/inbox` shows each brand's full address, built from that setting (`aliasAddress`, `features/inbox/admin/data.ts`, line 50). Copy it from there on the day. Never write a real address into this repo, an issue or a pull request.
- **Slug shape:** `^[a-z0-9][a-z0-9-]{1,39}$` (`features/inbox/addresses.ts`, line 4): 2 to 40 characters, lowercase letters, digits and dashes, starting with a letter or digit. The database checks the same shape and allows each slug for one brand only. All 62 slugs above match the shape and are unique. None is a sample brand's slug (`northwind`, `juniper`, `cedar-lane`, `cedar`).
- **How an arrival finds its brand.** The poll worker (`features/inbox/worker.ts`, lines 182 and 183) reads the recipients in this order: Delivered-To, X-Original-To, To, Cc (`features/inbox/mime.ts`, lines 138 to 144). `aliasSlug` (`features/inbox/addresses.ts`, lines 30 to 50) takes the first recipient that is the inbox's own address with a `+tag`, and returns the tag in lowercase when it has the slug shape. Gmail ignores dots in the name and treats `googlemail.com` as `gmail.com`, and so does the code (lines 16 to 23). A tag with a second `+`, an underscore, or the wrong length gives no slug. The database (`record_inbox_message`, `supabase/migrations/20260914090039_inbox_capture_commands.sql`, lines 104 to 168) then looks for the brand with that `alias_slug`. Example: Gmail delivers a newsletter to `<inbox-local>+tatcha@<inbox-domain>`. The slug is `tatcha`, so the email goes to the Tatcha brand in the directory.
- **Why sender domains matter.** Anyone can guess a `+alias`. So when a brand has registered sender domains, an email to its alias from any other domain is held for a person instead of being assigned (lines 153 to 159). Registering the brand's own root domain also covers all its subdomains (`mail.brand.com`).

## 4. The pilot plan

### Which industry first

**Recommended: skincare.** Raman picks.

- The Step 0 proof brand is a small DTC skincare brand (`docs/step0/README.md`). The first gates (the Brand book, the 15-day plan, 10 emails for one brand) are judged on one brand. Suggestions only show brands of the store's own industry (ONB-065a, REAL-01a), so skincare emails help those gates first.
- Skincare brands send often, so one week gives enough emails to judge the pilot.
- All 8 skincare brands have a clear public sign-up.

**Proposed order for the rest:** jewelry, apparel, home, fitness, kitchen, pet, beauty tools. This is a proposal: jewelry and apparel come next because they are common niches for the small online stores VISION aims at. Supplements and baby come only after Raman rules on them (2.9).

### Who signs up

A **person, by hand**, signed in to the inbox account in a normal browser, **after Raman's OK**. Not the app, not a script, not a Claude session. Signing up is an outside action in the owner's name (ledger, Blocked).

### Each sign-up, step by step

1. **A platform admin adds the brand** in the brand directory at `/admin/inbox`, on the same day as the sign-up. Fill in: the domain, the slug as the alias, the brand name, the niche word exactly as in section 1 (for example `beauty tools`), and as sender domains the brand's own domain plus any extra domain from 2.11. Saving sets the brand to "pending" (`admin_save_inbox_brand`, same migration, line 324). Add the brand first: otherwise its first emails wait in the ops queue.
2. **The person opens the brand's own website** and finds the newsletter box (footer or pop-up).
3. **They type only the brand's plus-address**, copied from the directory. No name, birthday, phone or ZIP code. No text-message (SMS) sign-up. No account, no purchase, no partner offers. A spin-to-win pop-up is fine if it asks only for the email.
4. **If the form needs more than an email, they skip the brand** and record why.
5. **A "confirm your subscription" email** may arrive. The app clicks the link itself when it stays on the brand's own domain, its sender domains or a well-known email service (INB-004). Otherwise a task, "Confirm a subscription by hand", appears in `/admin/inbox`. The person may then click the link in the inbox, after checking it goes to the brand's own site.
6. **Record the sign-up** (below).

### Pace

- **At most 3 sign-ups a day**, one industry at a time. Skincare takes 3 days.
- Start the next industry only after the previous industry's 7-day check (section 5) has passed.
- About 62 brands in 6 to 8 weeks. The target of 200+ per industry (#45) comes in later rounds, with smaller brands, once this pilot has worked.

### What is recorded per sign-up

**Date, slug and status**, plus a short note for a skip. Statuses: signed up, skipped (with the reason), waiting for confirmation, welcome arrived, newsletters arriving, no email after 7 days, stopped.

The directory already shows each brand's status (pending, subscribed, unsubscribed), last email and newsletter count. It does not keep the sign-up date, skips, or how many emails have sections. **A sign-up tracker would be a follow-up row**, after Raman's OK. It is not built here. Until then, the person keeps the three fields in a private note outside this public repository, with no real email addresses in it.

## 5. How arrivals are checked

Everything below already exists in INB-001 to INB-004. A person looks at `/admin/inbox` once a day during the pilot.

| Check                            | What it means                                                                                                                                                                                                                                                                                                                                                                                    | Where it shows                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The alias slug matches the brand | The email's `+slug` is the brand's alias, so it is assigned "by alias"                                                                                                                                                                                                                                                                                                                           | Directory: the brand's last email and newsletter count go up; its status becomes "subscribed"                                                 |
| The sender domain matches        | The From domain is the brand's domain, a subdomain, or a registered extra domain. An email to the alias from any other domain is held: "Email to +slug from …, a sender not registered for that brand". Assign it only when that domain really sends that brand's mail (its own other domain). Never assign a shared domain (`gmail.com`, an email service's shared sending domain; see INB-006) | Ops queue ("Needs a person")                                                                                                                  |
| No duplicates                    | Each email is stored once, keyed by its Message-ID, or by its bytes when it has none (`messageKey`, `features/inbox/addresses.ts`, lines 68 to 74). A re-delivered copy is counted as a duplicate, not a new email                                                                                                                                                                               | The count does not jump on a re-delivery                                                                                                      |
| The sections parse               | INB-002 keeps each email's images and takes a 600px screenshot; INB-003 cuts an email with HTML into sections, crops a picture of each and labels them                                                                                                                                                                                                                                           | No page shows section counts yet; a platform admin can read the brand's `email_sections`. The tracker follow-up should show a count per brand |
| The admin inbox shows it         | The brand row shows "subscribed", a last email date and a count                                                                                                                                                                                                                                                                                                                                  | Directory                                                                                                                                     |

**First-week checks for each brand** (count from the sign-up day):

- **Day 2:** did a welcome or confirmation email arrive? Many brands send one within minutes. If nothing arrived, look in the inbox account's Spam folder: the app reads the main inbox only (INB-001), so mark the brand's email "Not spam" there.
- **Day 2:** does the first email have an **unsubscribe link** (in the footer, or Gmail's "Unsubscribe" next to the sender)? The code does not check this; the person does. No unsubscribe link counts as a legal concern (stop rule, item 6).
- **Day 7:** has an ordinary newsletter arrived? The app checks this too: after 7 days without a newsletter it opens one task, "No newsletter yet from … after a week" (`check_pending_subscriptions`, `supabase/migrations/20260914090045_inbox_ops_locks.sql`, line 145). The 7 days count from when the brand was saved, which is why step 1 says "same day".
- **Day 7:** no more than 10 emails from the brand in the 7 days (stop rule, item 2).

**An industry passes its 7-day check** when at least half of its sign-ups have a newsletter, no stop condition happened, and the ops queue has no open task for its brands that nobody understands.

## 6. When an arrival is not assigned

**What the supervisor saw.** On 20 November 2026 the supervisor reported that the real inbox is live in production. The latest sweep said: transport `gmail_imap`, ready, not synthetic, **2 unassigned**, and more emails waiting for the next sweep. This plan did not read the inbox or any live data. What those two emails are is for an admin to look at on `/admin/inbox`.

### The path an arrival takes (the code as it is)

1. **The +alias slug.** The worker reads the recipients (Delivered-To first) and sends the database the slug, if any, and the sender domain (`senderDomain`, `features/inbox/addresses.ts`, lines 53 to 58: the From domain in lowercase, only when it is a real host name).
2. **The brand with that slug.** `record_inbox_message` looks for a brand of the same kind (sample or real) with that alias. If the brand has registered sender domains and the From domain is not one of them (or a subdomain), the email is held instead.
3. **The sender domain.** With no brand found by slug, and nothing held, it looks for a brand that registered the From domain (or its parent), the longest match first.
4. **Otherwise the email is unassigned** and a task opens in the ops queue (same migration, lines 205 to 211). The email is kept (raw copy in the private bucket) but stays out of the Inspiration library and every count.

### What makes an arrival unassigned

- **No `+tag`** (sent to the bare inbox address, such as the email provider's own account notices), and a From domain no brand registered.
- **A slug no brand has**: signed up before the brand was saved, or a typo in the address. The slug is kept on the email, but the database then only tries the sender domain.
- **A tag that is not a slug** (one character, an underscore, a second `+`, more than 40 characters): treated like no tag.
- **A known slug from an unregistered sender**, when that brand has registered sender domains. Task: "Email to +slug from …, a sender not registered for that brand".
- **Real mail to a sample brand's slug**: sample and real never mix.
- **No readable From domain** and no tag: task "Email from an unknown sender: an unknown sender".

Unreadable and oversized emails are not "unassigned": they get their own tasks ("could not be read", "too large").

### What an admin does today

On `/admin/inbox`, under "Needs a person" (`features/inbox/admin/views.tsx`, lines 39 to 48 for the words, 150 to 180 for the form):

1. **Look at what it is** before doing anything.
2. **A pilot brand's newsletter, brand not in the directory yet:** add the brand first (section 4, step 1).
3. **Then "Assign to this brand"** on the task (`admin_assign_sender`, `supabase/migrations/20260914090045_inbox_ops_locks.sql`, line 58). It registers that sender domain for the brand, assigns every waiting email from it and its subdomains, and closes the task. Later emails from that domain go to the brand by themselves.
4. **Not a brand newsletter** (the email provider's own notice, a personal email, spam): **Dismiss** with a note. Never assign it. A person's name or address in a brand's library would break REAL-01a.
5. **From a shared domain** (`gmail.com`, an email service's shared sending domain): do not assign it, because every later email from that domain would follow. Dismiss with a note (INB-006).
6. **No sender domain:** the page offers no Assign button, only Mark done or Dismiss (INB-005).

### Checked on fixtures

`features/inbox/arrivals.test.ts` (new, 8 tests) feeds synthetic arrivals through the same functions the worker uses (`readInboxMessage`, `aliasSlug`, `senderDomain`, `messageKey`), with reserved `.test` sender domains and inbox names that cannot be real Gmail addresses (Gmail names have no dash):

- a known slug and a sending subdomain;
- an unknown slug, passed on as it is (the database then tries the sender);
- no tag: no slug, only the sender domain;
- Gmail dots, capitals and `googlemail.com`;
- the slug read from Delivered-To when To shows the brand's list address;
- another inbox, an underscore, one character and 41 characters: no slug;
- a re-delivered copy keeps its key;
- the ten D7 niche words map to their industries.

The database side is covered by `supabase/tests/inbox_capture.test.sql` (lines 82 to 100): the alias of a brand without senders, a sender's subdomain, an alias from a registered sender, an alias from an unregistered sender (held, with its reason), real mail never in a sample brand, a duplicate recorded once, and an unknown sender as one counted task. No database test names an unknown slug; the code treats it like no tag (INB-005 adds the test).

### Gaps found (follow-up rows, not built here)

- **INB-005:** the page cannot assign one email by itself. The command `admin_assign_inbox_message` and the `assign_message` action exist (`features/inbox/admin/actions.ts`, line 28), but the page shows no button for them. So an arrival with no readable sender domain cannot be assigned. The row also adds a database test for an unknown slug.
- **INB-006:** nothing stops a shared domain (`gmail.com`, `googlemail.com`, an email service's shared sending domain) from becoming one brand's sender, through "Assign to this brand" or the brand form. One click would send every later email from that domain, people's own mail included, to that brand.
- A brand saved with **no sender domains** takes any email sent to its alias (known since INB-001). This pilot avoids it: step 1 always adds the brand's own domain.

## 7. Stop rule

**Pause the whole pilot** (no new sign-ups, no confirm clicks by hand) as soon as any of these happens:

1. **Personal data:** an arrival contains a person's name or email address outside the brand's own content. Examples: an email meant for someone else, a greeting with a name we never gave, a forwarded personal email.
2. **Too many emails:** one brand sends more than 3 emails on each of two days, or more than 10 in 7 days.
3. **Inbox health:** the inbox account gets a spam flag, a security warning, a "verify it's you" lock or any other warning from the email provider, or the app's inbox login fails (the task "Gmail refused the inbox login").
4. **Too few deliver:** fewer than half of an industry's sign-ups deliver a newsletter within 7 days.
5. **Login or payment:** an arrival needs an account, a login or a payment to confirm or to read it, or a "free trial" that would bill.
6. **Legal or terms:** a site's terms forbid this kind of sign-up, a brand complains or asks us to stop, an email has no unsubscribe link, or a brand turns out to be in an excluded group (adult, gambling, alcohol, tobacco, weapons, health claims, aimed at children).

**What happens then:** the person stops and writes down what happened (date, slug, what was seen, with no personal data copied). Emails already arriving are left alone; unsubscribing is also an outside action, so Raman decides it.

**Only Raman restarts the pilot**, in the conversation, after he has seen what happened.

## 8. What is not done

- **No sign-up was performed.** No form was filled in, no email was sent or opened, and no confirm link was clicked.
- **The industry and the go-ahead still come from Raman**, and so does the choice of who signs up. Supplements and baby wait for his ruling.
- **No live provider was switched on.** No live data or real inbox was read. The live numbers in section 6 are the supervisor's observation.
- **No real email address is in this repository.** The addresses above are placeholders.
- **Not built:** the sign-up tracker (a later row, after Raman's OK), INB-005 and INB-006 (follow-up rows in the ledger).
