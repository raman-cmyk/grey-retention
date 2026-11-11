# Block library (VISION Step 1)

Every email Grey Retention builds is a sequence of these **20 block types**. The AI picks the blocks and fills them with the client's own products, photos and new copy. The code then draws them in the client's brand. When the app reads a competitor email, the labeller (BLK-003) may only answer one of these 20 names. There is **no countdown timer** in v1.

The reference set is the Step 0 renderer ([`docs/step0/render.py`](step0/render.py)): its 10 types (marked "Step 0") keep their names and their input fields, and the Step 0 example ([`docs/step0/example_spec.json`](step0/example_spec.json)) is valid input, which a test checks. The other 10 follow the same field conventions.

**Owner approval: approved.** Raman approved this list as is on 7 November 2026 (issue BLK-001, #295). A change to the list needs his approval again. The code is in `features/blocks/catalog.ts`. A test checks that this table matches the code.

| #   | Block                                                      | What it is for                                                             | Content it needs                                                            |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | **Announcement bar** (`announcement_bar`) · Step 0         | A thin strip with one short line: a launch, free shipping, a deadline.     | One short line (free-shipping and delivery facts come from the facts sheet) |
| 2   | **Logo header** (`header_logo`) · Step 0                   | Opens the email with the brand logo, linked to the store.                  | Nothing to write: the logo and store link come from the brand kit           |
| 3   | **Product hero** (`hero_product`) · Step 0                 | The product on a brand-colour panel, with a short headline and one button. | Product photo, small eyebrow line, headline, short line, button             |
| 4   | **Photo hero** (`hero_image`)                              | A full-width lifestyle photo, then the main message and one button.        | Wide photo, headline, short line, button                                    |
| 5   | **Offer banner** (`offer_banner`)                          | States the offer and the code in large text on a brand colour.             | Offer headline, code from the client list, end date, button                 |
| 6   | **Text section** (`text`) · Step 0                         | Plain paragraphs, like a letter. Good for text-first emails.               | Optional heading, 1 to 4 paragraphs                                         |
| 7   | **Numbered steps** (`steps`) · Step 0                      | A numbered list: how to use it, how ordering works, or reasons to buy.     | 2 to 5 steps, each a short title and one line                               |
| 8   | **Single product feature** (`product_feature`)             | One product up close: photo, name, price, why it is good.                  | 1 featurable product, short copy, button                                    |
| 9   | **Product grid, 2 columns** (`product_grid_2col`) · Step 0 | Two or four products side by side, each with price and link.               | 2 or 4 featurable products                                                  |
| 10  | **Product grid, 3 columns** (`product_grid_3col`)          | Three or six smaller products, for a range or a collection.                | 3 or 6 featurable products                                                  |
| 11  | **Category tiles** (`category_tiles`)                      | Photo tiles that send shoppers to collections.                             | 2 or 4 collection photos with a label and link                              |
| 12  | **Image and text** (`image_text`)                          | A photo beside a short story; the photo comes first on a phone.            | Photo, heading, a few lines, optional button                                |
| 13  | **Founder note** (`founder_note`)                          | A short personal note signed by the founder.                               | Optional photo, note, name and role                                         |
| 14  | **Review strip** (`review_strip`)                          | One to three real customer reviews with star ratings.                      | 1 to 3 confirmed reviews (quote, name, stars)                               |
| 15  | **Customer photo grid** (`ugc_grid`)                       | Photos customers shared, in a grid, to show the product in use.            | 3 or 6 customer photos, optional caption and button                         |
| 16  | **Before and after** (`before_after`)                      | Two real photos that show the change the product makes.                    | Before photo, after photo, short caption                                    |
| 17  | **FAQ** (`faq`) · Step 0                                   | Answers to the questions that stop people buying.                          | 1 to 5 questions with short answers from the facts sheet                    |
| 18  | **Button** (`cta`) · Step 0                                | One clear button on its own.                                               | Button words and link                                                       |
| 19  | **Sign-off** (`signoff`) · Step 0                          | A short closing line from the brand, like "With love, the team".           | One short line                                                              |
| 20  | **Footer** (`footer`) · Step 0                             | Closes every email with Klaviyo's required links and the address.          | Nothing to write: brand, address, unsubscribe, preferences, view in browser |

## How every block is drawn

- **Brand kit:** the logo, the store link, the brand font and the four colour roles from Step 0: ink (text), background (around the email), accent (buttons and highlights) and dark (the announcement bar). The email itself sits on white, as in Step 0. Text on a colour is black or white, whichever reads better. A brand colour too pale to read is replaced by the readable ink: small text needs 4.5:1 contrast, big headings 3:1.
- **Fonts:** the brand font comes first, then a web-safe font of the same kind (for example `'Playfair Display', Georgia, 'Times New Roman', Times, serif`). Most inboxes don't have the brand font and use the fallback.
- **Email-safe HTML:** tables and inline styles; 600px wide on a computer; side-by-side columns stack into one on a phone (checked at 375px). No scripts, forms, web-font links or external stylesheets.
- **No text inside images:** headlines, prices, codes and buttons are real text. Product pictures are real catalog photos.
- **Footer:** every email ends with exactly one footer. It uses the Klaviyo tags that rendered correctly in the Step 0 drafts: `{{ organization.name }}`, `{{ organization.full_address }}`, `{% unsubscribe "Unsubscribe" %}`, `{% manage_preferences "Preferences" %}` and `{% web_view "View in browser" %}`. Klaviyo fills these when it sends. Our own previews show labelled placeholders instead.
- **Safety:** every block is checked against its rules again when it is drawn. All text is escaped, including `{` and `}`, so copy can never become a Klaviyo template tag. Links must be `https`, `http` or `mailto`. Pictures must be `https`; an email going to Klaviyo must use pictures already uploaded there, and inline sample pictures are refused.
- **Outlook:** buttons and coloured bars carry `bgcolor`, and button padding sits on the table cell, so they keep their shape in Outlook for Windows.
- **Size:** all 20 blocks together stay under Gmail's clipping size (about 102 KB).
