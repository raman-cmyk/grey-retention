# Block library (VISION Step 1)

Every email Grey Retention builds is a sequence of these **20 block types**. The AI picks the blocks, fills them with the client's own products, photos and new copy, and the code draws them in the client's brand. When the app reads a competitor email, the labeller (BLK-003) may only answer one of these 20 names. There is **no countdown timer** in v1.

Claude chose the list from email-marketing practice (decision D3: there is no human designer). **Owner approval: pending.** Raman approves the list (issue BLK-001, #295) or asks for changes. The code lives in `features/blocks/catalog.ts`; this table is generated from it.

| #   | Block                                          | What it is for                                                        | Content it needs                                               |
| --- | ---------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | **Logo header** (`header`)                     | Opens the email with the brand logo and up to three links.            | Logo (or the brand name), up to 3 short links                  |
| 2   | **Hero** (`hero`)                              | The big first impression: one photo, the main message and one button. | Photo, headline, short line, button                            |
| 3   | **Offer banner** (`offer_banner`)              | States the offer and the code in large text on a brand colour.        | Offer headline, code from the client list, end date, button    |
| 4   | **Free-shipping bar** (`free_shipping_bar`)    | A thin strip with one fact the shopper cares about.                   | One short line from the facts sheet                            |
| 5   | **Single product feature** (`product_feature`) | One product up close: photo, name, price, why it is good.             | 1 featurable product, short copy, button                       |
| 6   | **Product grid, 2 columns** (`product_grid_2`) | Two or four products side by side, each with price and link.          | 2 or 4 featurable products                                     |
| 7   | **Product grid, 3 columns** (`product_grid_3`) | Three or six smaller products, for a range or a collection.           | 3 or 6 featurable products                                     |
| 8   | **Category tiles** (`category_tiles`)          | Photo tiles that send shoppers to collections.                        | 2 or 4 collection photos with a label and link                 |
| 9   | **Image and text** (`image_text`)              | A photo beside a short story; stacks on a phone.                      | Photo, headline, a few lines, optional button                  |
| 10  | **Text section** (`text`)                      | Plain paragraphs, like a letter. Good for text-first emails.          | Optional headline, 1 to 4 paragraphs                           |
| 11  | **Founder note** (`founder_note`)              | A short personal note signed by the founder.                          | Optional photo, note, name and role                            |
| 12  | **Review strip** (`review_strip`)              | One to three real customer reviews with star ratings.                 | 1 to 3 reviews (quote, name, stars)                            |
| 13  | **Customer photo grid** (`ugc_grid`)           | Photos customers shared, in a grid, to show the product in use.       | 3 or 6 customer photos, optional caption and button            |
| 14  | **Before and after** (`before_after`)          | Two real photos that show the change the product makes.               | Before photo, after photo, short caption                       |
| 15  | **Benefits** (`benefits`)                      | Three reasons to buy, each a short title and one line.                | 3 benefits from the facts sheet                                |
| 16  | **How it works** (`how_it_works`)              | Three numbered steps: how to use it or how ordering works.            | 3 steps (title and one line)                                   |
| 17  | **Comparison table** (`comparison`)            | Us against the usual alternative, row by row.                         | 2 column labels, 3 to 5 rows                                   |
| 18  | **FAQ** (`faq`)                                | Answers to the questions that stop people buying.                     | 2 to 5 questions with short answers from the facts sheet       |
| 19  | **Button section** (`cta`)                     | A last push: one line and one clear button.                           | Optional headline and line, button                             |
| 20  | **Footer** (`footer`)                          | Closes every email with Klaviyo's required links and the address.     | Nothing to write: brand, unsubscribe, address, view in browser |

## How every block is drawn

- **Brand kit:** the logo, 3 colours (main, accent, page) and the brand font. Text on a colour is black or white, whichever reads better. A brand colour too pale to read as a headline is replaced by the readable ink.
- **Fonts:** the brand font comes first, then a web-safe font of the same kind (for example `'Playfair Display', Georgia, 'Times New Roman', Times, serif`). Most inboxes don't have the brand font and use the fallback.
- **Email-safe HTML:** tables and inline styles; 600px wide on a computer; side-by-side columns stack into one on a phone (checked at 375px). No scripts, forms, web-font links or external stylesheets.
- **No text inside images:** headlines, prices, codes and buttons are real text. Product pictures are real catalog photos.
- **Footer:** every email ends with exactly one footer. It carries Klaviyo's required links and details: view in browser, unsubscribe, manage preferences, the organisation name and the physical address. Klaviyo fills these when it sends. Our own previews show labelled placeholders instead.
- **Safety:** all text is escaped, including `{` and `}`, so copy can never become a Klaviyo template tag. Links must be `https`, `http` or `mailto`. Images must be `https` (Klaviyo-hosted when sent).
- **Size:** all 20 blocks together stay under Gmail's clipping size (about 102 KB).
