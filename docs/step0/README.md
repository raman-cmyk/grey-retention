# Step 0: one brand done by hand (findings for the build)

Before automating anything, the supervisor did the whole v2 loop by hand for one real client: a small DTC skincare brand ("Brand V" here; the repo is public, so no client names, links or numbers). This page is what the build should learn from it. The full client pack lives outside the repo.

## What was done (7 Nov 2026)

1. **Read the account.** Klaviyo account details, 90 days of campaign results, segments, lists, metrics, catalog.
2. **Read the store.** Public product feed, policy pages, shipping page, logo, colours, fonts.
3. **Read the competitors.** 6 similar brands, using public email archives.
4. **Wrote the brief.** 8 actions, each tagged with its evidence: own results [K], competitors [C], site [S].
5. **Planned 2 weeks.** 6 sends (Tue/Thu/Sun, brand's usual time slot, engaged-90-days audience).
6. **Built 3 emails** with the block renderer in this folder (`render.py`, example input `example_spec.json`).
7. **Pushed them as Klaviyo drafts.** Images were uploaded to Klaviyo first, then templates were created, then campaigns plus messages were created, unscheduled. Nothing was sent.

All three drafts rendered correctly in Klaviyo's own thumbnail render: logo, hero, product grid, buttons and footer.

## What the product must do (learnings)

| #   | Finding                                                                                                                                                                        | What to build                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The Klaviyo catalog was empty.**                                                                                                                                             | Onboarding stops and says so (VISION §10). With the owner's OK, it can fall back to the store's public product feed.                                                                            |
| 2   | **The catalog needs cleaning.** One product had 5 listings, plus a translated duplicate, sale copies, blank product types, and a compare-at price that is always 2× the price. | A catalog clean-up step in onboarding: group duplicates, hide sale copies, and flag a "permanent compare-at" so emails never show a fake "50% off".                                             |
| 3   | **The brand facts sheet caught 2 traps.** Two pages gave different guarantees (60-day vs 30-day/no returns), and delivery takes 2–4 weeks.                                     | The facts sheet has "guarantee", "returns" and "delivery time" fields. When pages conflict, it asks the owner. Copy QA blocks guarantee or delivery-date claims that the sheet doesn't confirm. |
| 4   | **Competitor data is the bottleneck.** Public archives block automated reading, so the evidence was thin.                                                                      | Our own inbox (V2-S2) comes before brief automation. The brief must show "evidence: weak" when fewer than ~3 dated competitor emails back an action.                                            |
| 5   | **The logo was a background-removed screenshot.**                                                                                                                              | Onboarding asks for a clean logo (SVG or large PNG) and shows a preview.                                                                                                                        |
| 6   | **Prices differ by market.** The store showed a local currency to the browser.                                                                                                 | Read prices from the product feed in the account's currency, not from the rendered page.                                                                                                        |
| 7   | **Product images contain claims as text** (for example "results in 14 days" printed on the photo).                                                                             | Copy QA can't read image text. Show a warning: "this image may contain claims; check it". A later version can OCR images.                                                                       |
| 8   | **QA false positives.** A "100%" inside CSS and a "5%" inside a product name were flagged as discounts.                                                                        | The claim checker reads only visible text, and ignores numbers that are part of a product name.                                                                                                 |
| 9   | **The best past campaign was a founder FAQ**, not a sale.                                                                                                                      | The brief must rank past campaigns by revenue per recipient, not by type, so non-sale wins show up.                                                                                             |

## Guardrails used (keep these as rules)

- No discount codes unless the owner gave them. The AI never invents one.
- No "% off" when the compare-at price is permanent.
- No guarantee, delivery-date, review or testimonial claims without a confirmed source.
- Images are the brand's own product photos, uploaded to Klaviyo before use.
- Drafts only. Scheduling or sending needs the owner's approval.

## Klaviyo push recipe that worked

1. `upload_image_from_url` for every image. Use the returned Klaviyo URLs in the HTML.
2. Create the template (code editor, full HTML). The footer must include `{{ organization.name }}`, `{{ organization.full_address }}`, `{% unsubscribe %}`, `{% manage_preferences %}` and `{% web_view %}`.
3. Create the campaign with `audiences` (included and excluded) at the attributes level, and the name and send settings inside `definition`. Don't put messages inline.
4. Create the campaign message with the template, subject and preview text, linked to the campaign.
5. Leave it unscheduled. Read it back and check the template's `screenshot_url` render.

## Block renderer

`render.py` turns a brand kit plus a list of blocks into email-safe HTML: tables, inline styles, 600px wide, one column on mobile, no JavaScript, live text. The block types are `announcement_bar`, `header_logo`, `hero_product`, `text`, `steps`, `product_grid_2col`, `faq`, `cta`, `signoff` and `footer`. It is a reference for V2-S1 (the block library), not production code.

```bash
python3 docs/step0/render.py docs/step0/example_spec.json out.html
```
