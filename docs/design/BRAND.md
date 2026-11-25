# GROS brand guidelines

**Status: draft 1, 15 November 2026. Waiting for the owner to approve.** Until then this is a proposal. It replaces the visual direction in `DESIGN_RULES.md` once approved.

This file is the single source for how the app looks and reads. Builders: use only these tokens and components. Do not add colors, sizes, radii, fonts or components. A page is built from its own spec in `docs/design/<page>.md`, which uses what is here.

The same content, with live previews of every component, is in the Claude artifact "GROS Brand Guidelines".

## Tokens

Put these in `app/globals.css` as CSS variables with exactly these names (Tailwind 4 `@theme`), and use the variables everywhere. No raw hex values or pixel sizes in components.

### Color

| Token           | Value     | Use                                                                                                                                    |
| --------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--lime`        | `#B9F26C` | What is active or next: active menu item, next email row, the round open button, done checks, the one lime card. Text on it is forest. |
| `--lime-deep`   | `#A7E455` | The ring shape drawn on a lime card. Never for text.                                                                                   |
| `--lime-tile`   | `#CDF696` | Small tiles inside a lime card. Text on it is forest.                                                                                  |
| `--lime-soft`   | `#E3F8C4` | Highlighted row and the In Klaviyo pill. Text on it is forest or ink.                                                                  |
| `--forest`      | `#14401F` | The main button of a card, text on lime, focus ring, done day cells. Text on it is white.                                              |
| `--ink`         | `#0F1410` | All main text and numbers on white and mist.                                                                                           |
| `--ink-soft`    | `#3F463E` | Secondary text on lime-soft, where stone is too light.                                                                                 |
| `--stone`       | `#5F665E` | Labels, secondary text and quiet buttons on white and mist. Never on lime.                                                             |
| `--mist`        | `#F2F3F0` | Page background, input fill, tiles inside white cards, empty day cells.                                                                |
| `--white`       | `#FFFFFF` | Cards, the page shell in onboarding, text on forest.                                                                                   |
| `--line`        | `#E3E6DE` | The rare hairline: a white swatch on white. Cards have no border.                                                                      |
| `--signal`      | `#E5541B` | Fill for a needs-you mark. Use only when the owner must act. Not for text.                                                             |
| `--signal-ink`  | `#9A3412` | Needs-you and Avoid text, on white or signal-soft.                                                                                     |
| `--signal-soft` | `#FCE9E0` | Background of a needs-you pill, an Avoid mark and an error card.                                                                       |

### Type

Font: Urbanist (Google Fonts), weights 400, 500, 600. Load it with `next/font`.

| Style         | Size | Line height | Weight | Letter spacing | Use                                                            |
| ------------- | ---- | ----------- | ------ | -------------- | -------------------------------------------------------------- |
| `number-xl`   | 84px | 0.9         | 500    | -0.04em        | The one hero number on a screen.                               |
| `number-lg`   | 60px | 1           | 500    | -0.03em        | The main number of a card.                                     |
| `number-md`   | 28px | 1.1         | 500    | -0.02em        | Numbers inside a tile.                                         |
| `display`     | 60px | 1.02        | 500    | -0.03em        | Onboarding panel headline only.                                |
| `title`       | 44px | 1.05        | 500    | -0.02em        | The title of a focused screen: onboarding steps, empty states. |
| `page-title`  | 26px | 1.2         | 500    | -0.01em        | The title in the top bar of an app page.                       |
| `heading`     | 22px | 1.2         | 600    | 0              | Card titles.                                                   |
| `body`        | 17px | 1.4         | 400    | 0              | Default text.                                                  |
| `body-strong` | 17px | 1.4         | 600    | 0              | Row titles and button text.                                    |
| `label`       | 15px | 1.3         | 500    | 0              | The label that names a number or a field.                      |
| `caption`     | 14px | 1.3         | 500    | 0              | Row details, pills, legends. The smallest size allowed.        |

### Spacing

| Token        | Value | Use                                                          |
| ------------ | ----- | ------------------------------------------------------------ |
| `--space-1`  | 4px   | Between a label and its value.                               |
| `--space-2`  | 8px   | Between a field label and the field; between list tiles.     |
| `--space-3`  | 12px  | Inside rows and small tiles; between buttons.                |
| `--space-4`  | 16px  | Between items in a top bar; tile padding.                    |
| `--space-5`  | 20px  | The gap between cards. Between a card title and its content. |
| `--space-6`  | 24px  | Page gutter.                                                 |
| `--space-7`  | 28px  | Padding of a small card. Between blocks inside a large card. |
| `--space-8`  | 32px  | Padding of a large card.                                     |
| `--space-10` | 40px  | Padding of the onboarding panel.                             |
| `--space-12` | 48px  | Top and bottom room on a focused screen.                     |

### Radius

| Token           | Value | Use                                                       |
| --------------- | ----- | --------------------------------------------------------- |
| `--radius-sm`   | 12px  | Email thumbnails, day cells.                              |
| `--radius-md`   | 18px  | Inputs, tiles inside cards, step cards, highlighted rows. |
| `--radius-lg`   | 28px  | Every card.                                               |
| `--radius-xl`   | 36px  | The white page shell around onboarding.                   |
| `--radius-pill` | 999px | Buttons, menu, status pills, progress bars.               |

### Sizes

| Token             | Value  | Use                                                       |
| ----------------- | ------ | --------------------------------------------------------- |
| `--control-sm`    | 44px   | Smallest control: menu items, row buttons, quiet buttons. |
| `--control-md`    | 52px   | Buttons on app pages.                                     |
| `--control-lg`    | 60px   | Inputs and the main button on a focused screen.           |
| `--control-round` | 64px   | The round lime open button.                               |
| `--page-max`      | 1320px | Widest the page content grows.                            |
| `--focus-ring`    | 2px    | Focus outline in forest, 2px away from the control.       |

## Rules

Thirty rules. A screen that breaks one is not done. Each rule can be checked by looking.

### Layout

1. The page is `mist`. Content sits on `white` cards. Inside a white card, group things with `mist` tiles, never with another white card or a border.
2. Content is at most 1320 px wide, with a 24 px gutter and 20 px between cards.
3. Each card answers one question and has at most one main button.
4. At most one lime card per screen.
5. Radius is only 12, 18, 28, 36 or pill. Cards are always 28.
6. No shadows, no gradients, no borders on cards, no divider lines between rows. Space separates things.

### Color

7. `forest` is the main button of a card. Two forest buttons in one card is a bug.
8. `lime` marks what is active or next. It is never used for text.
9. Text is `ink` on white and mist, `forest` on any lime, white on forest. `stone` is for labels on white and mist only.
10. `signal` appears only when the owner must act, and always with a word next to it. Color alone never carries meaning.
11. The store's brand colors and fonts appear only inside an email preview or a brand swatch.

### Type

12. One font: Urbanist. Weights 400, 500, 600. Nothing smaller than 14 px.
13. The number is the biggest thing on a card. Its label is small and sits right above or beside it.
14. Sentence case everywhere. No all caps. No full stop after a title or button.
15. No small label above a title. A label is allowed only to name a number or a field.

### Words

16. A screen title is one to four words. No subtitle. No helper paragraph.
17. A button is one to four words and starts with a verb: Plan next 15 days, Create email, Open in Klaviyo. Never Submit, OK, Continue to next step.
18. An error says what happened and what to do, in plain words. Never "Something went wrong".
19. No sales talk and no AI talk: no "AI-powered", "magic", "smart", "effortless", exclamation marks or emoji.
20. Use the owner's words: email, discount, code, draft, store. Not campaign asset, tenant, payload, sync job.

### Components

21. Build only with the components in this system. A new need goes to design first.
22. Controls are at least 44 px tall. Buttons on app pages are 52. Inputs and the main button on a focused screen are 60.
23. Icons are line icons with round ends. An icon-only button has a spoken label.
24. A status is a dot and a word in a pill. Never a colored dot alone.

### States

25. Every screen has a designed loading, empty and error state before it ships.
26. Loading shows what the agents are doing, step by step, in plain words. Never a bare spinner for more than a second.
27. An empty state is a title and one button. An error state is what happened, what to do, and one button.

### Motion and access

28. Motion only shows a change: a fade or a move of 8 px or less, 150 to 200 ms. No bounce, pulse, stagger or confetti.
29. Text contrast is at least 4.5 to 1. Everything works with a keyboard and shows a 2 px forest focus ring.

### Process

30. Nothing is built without an approved page spec. Sample data uses made-up names (Cedar Lane, cedarlane.example), never a real client.

## The brand book

GROS plans, writes and designs a store's emails and puts them in Klaviyo as drafts. The owner clicks two buttons: **Plan next 15 days** and **Create email**. The interface should feel like a calm, well-run studio: soft, bright, sure of itself, with almost no words.

Status: draft 1, 15 November 2026. Waiting for the owner's approval. The rules are in the Rules section. Read both before building or designing anything.

### How it should feel

- **Soft.** White rounded cards on a pale grey page. No hard edges, no shadows, no lines between things.
- **Bright.** One lime green that marks what is active or next. One deep green for the main button.
- **Confident.** Big numbers. Short titles. One clear thing to do on each card.
- **Quiet.** Few words. No explaining. If a screen needs a paragraph, the screen is wrong.

### Words

Write like a person who runs a store, not like software.

| Use                                    | Not                                         |
| -------------------------------------- | ------------------------------------------- |
| Plan next 15 days                      | Generate campaign calendar                  |
| Create email                           | Submit, Run AI, Generate                    |
| In Klaviyo                             | Synced, Pushed, Published                   |
| Biggest discount                       | Max discount threshold                      |
| Your store                             | Enter your store URL below to get started   |
| Klaviyo key stopped working. Reconnect | Something went wrong                        |
| Drafts only. Nothing sends             | Don't worry, we never send without approval |

- Sentence case. No all caps. No full stop at the end of a title or a button.
- A title is one to four words. A button is one to four words and starts with a verb.
- No exclamation marks, no emoji, no "AI-powered", "magic", "smart", "effortless", "supercharge".
- An error says what happened and what to do. One short sentence each.
- Numbers use the store's currency and commas: `$12,480`. Dates are short: `Fri 20`, `16 to 30 Nov`.

### Color

Lime and forest carry the brand. Everything else is white, mist and ink.

- `mist` is the page. `white` is every card. `mist` is also the fill of inputs and of tiles inside a white card.
- `forest` is the main button of a card, with white text. One per card.
- `lime` marks what is active or next: the active menu item, the next email, the round open button, done checks. One lime card per screen at most. Text on lime is `forest`.
- `lime-soft` highlights one row. `lime-tile` is for tiles inside the lime card. `lime-deep` is only the ring shape.
- `ink` is text. `stone` is labels and secondary text on white and mist. Never put `stone` on lime.
- `signal`, `signal-ink` and `signal-soft` appear only when the owner must do something, and always with words.

### Type

One family: **Urbanist**, weights 400, 500 and 600. It is loaded from Google Fonts.

- Numbers are the loudest thing on a card: `number-xl` once per screen, `number-lg` once per card.
- A small `label` names a number or a field. That is the only small text allowed above a larger one.
- `heading` for card titles, `body` for text, `caption` is the smallest size. Nothing under 14 px.
- Large type is tight: letter spacing from -0.02em to -0.04em, as set in the tokens.

### Shape and space

- Radius comes only from the scale: `radius-sm` 12, `radius-md` 18, `radius-lg` 28, `radius-xl` 36, `radius-pill`.
- Every card is `radius-lg` with `space-8` padding (or `space-7` for a small card). The gap between cards is `space-5`.
- Buttons, the menu, pills and bars are fully round.
- No shadows. No gradients. No borders on cards. Depth comes from white on mist.
- The only decoration: two or three `lime-deep` rings in the corner of a lime surface.

### Layout

- App pages: a top bar (mark and page title on the left, pill menu in the middle, round buttons on the right), then rows of cards. Content is at most `page-max` wide with a `space-6` gutter.
- Focused screens (onboarding, sign in): one white shell with `radius-xl`. A lime panel on the left shows where you are. The right side has one title, one or two fields and one button.
- Each card answers one question. The answer is a big number or a short list.
- Designed for a laptop at 1440 px. On a narrow screen, cards stack in one column and nothing scrolls sideways.

### Icons

Simple line icons: 1.8 to 2 px stroke, round ends, no fill, drawn on a 24 px grid, colored by the text color. Never emoji. An icon alone on a button needs a spoken label.

### The mark

A forest disc with a lime open ring. Use it at 36 to 44 px beside the page title or the word GROS. Do not recolor it, stretch it or place it on lime-soft or signal. This mark is a draft and may be redrawn.

### Components

Use only these. If a screen needs something that is not here, ask design. Do not invent one.

- **Button**: forest main, lime highlight, outline, quiet text, round icon.
- **Input**: mist fill, forest ring on focus, signal ring and one line of help on error.
- **Nav**: the pill menu and top bar.
- **Card**: white card, lime card, tile.
- **ListRow**: thumbnail, title, details, one action.
- **Status**: a dot and a word in a pill.
- **DayStrip**: the 15 days of a plan.
- **StepCard**: onboarding steps.
- **Progress**: what the agents are doing, step by step.
- **EmptyState**: empty and error cards.

### The client's brand stays inside the email

A store's own colors and fonts appear only inside an email preview or a brand swatch. They never color the app.

## Component guidelines

### Button

Buttons are fully round pills, in five kinds, and each card has at most one forest button.

| Kind    | Look                                 | Use for                                                        |
| ------- | ------------------------------------ | -------------------------------------------------------------- |
| Main    | `forest` fill, white text            | The one main action of a card: Plan next 15 days, Continue     |
| Lime    | `lime` fill, `forest` text           | The next thing to create, when the card already has a main one |
| Outline | white fill, 1.5 px `forest` border   | A second action beside the main one                            |
| Quiet   | no fill, `stone` text, weight 500    | Low-key actions: Change, Edit, Disconnect                      |
| Round   | 64 px `lime` disc with a 24 px arrow | Open the full page behind a card. One per card                 |

- Height: 52 px on app pages, 60 px on a focused screen, 44 px inside a list row. Never under 44.
- Text is 17 px, weight 600 (15 px in the 44 px size). One to four words, starting with a verb.
- Focus shows a 2 px `forest` ring, 2 px away.
- While working, keep the label and show progress in the card (see Progress). Do not swap the label for a spinner.
- Disabled: 40% opacity, and say why next to it.
- You provide: the label, the kind, and the action. An icon-only button also needs a spoken label.

### Input

A text field is a soft `mist` box with a bold label above it, and it never has a visible border until it is focused or wrong.

- Height 60 px, `radius-md` (18), 22 px side padding, text 19 px. On a white card the fill is `mist`. On a mist page the fill is `white`.
- Label: 15 px, weight 600, `ink`, 8 px above the field. Every field has a real label. No placeholder used as a label.
- Focus: 2 px `forest` border, white fill.
- Error: 2 px `signal` border and one line under the field in `signal-ink` that says what is wrong and what to do.
- Found or valid: a 28 px `lime` disc with a forest check at the right edge.
- Ask only for what is needed on this step. Prefill everything that is already known.
- You provide: the label, the value, and the error sentence when there is one.

### Nav

The top bar is the only navigation: the mark and page title on the left, a white pill menu in the middle, and round white buttons on the right.

- The menu is a white pill with 6 px padding. Each item is 44 px tall with 22 px side padding, 16 px text.
- The current page is a `lime` pill with `forest` text, weight 600. Other items are `stone`, weight 500.
- Six items at most: Home, Plan, Inspiration, Audiences, Results, Brand (Brand added by the owner's decision of 25 November 2026; the Brand book and Brand assets are pages under it). Settings is the round button on the right. Ask GROS is the wide button beside it.
- The left side shows the mark (44 px) and the page title in `page-title`. On Home the title greets the store.
- No sidebar on app pages. Only Ask GROS uses a side list, for past chats.
- On a narrow screen the three parts wrap onto their own lines. Nothing is hidden behind a menu icon.
- You provide: which item is current, and the page title.

### Card

A card is a white rounded surface on the mist page that answers one question, usually with one big number.

- White card: `white` fill, `radius-lg` (28), `space-8` (32) padding, or `space-7` (28) for a small card. No border, no shadow.
- Lime card: `lime` fill, all text `forest`, with two or three `lime-deep` rings bleeding off the top right corner. One per screen at most. Use it for the number the owner is proudest of.
- Tile: a small box inside a card. `radius-md` (18), 16 by 18 px padding. `mist` inside a white card, `lime-tile` inside the lime card. A tile holds a label and a `number-md`.
- Order inside a card, top to bottom: label or title, the big number, supporting tiles or list, then actions.
- Never put a white card inside a white card. Never add a divider line. Cards sit 20 px apart.
- A change badge (for example +18%) is a white pill, 30 px tall, 14 px weight 600, beside the number.
- You provide: the label, the number or list, and at most one main action.

### ListRow

A list row shows one email (or one code, segment or rule) as a thumbnail, a title, one line of details and one action on the right.

- Row: 12 px padding, `radius-md` (18), 14 px between parts, 10 px between rows. No divider lines.
- Thumbnail: 44 by 56 px, `radius-sm` (12). For a designed email it is a tiny picture of the email in the store's colors. For a text email it is three grey lines on `mist`.
- Title: 17 px, weight 600, one line. Details: 14 px, weight 500, `stone`, parts joined with a middle dot: `Fri 20 · Past buyers`.
- The row that is next gets a `lime-soft` background and the forest button. Only one row in a list is next. On it, details text is `ink-soft`.
- Other rows get an outline button, or a status pill when there is nothing to do.
- One action per row. More actions live on the row's own page.
- You provide: thumbnail, title, details, and either an action or a status.

### Status

A status is a small pill with a dot and one or two words, and there are only four of them.

| Status     | Look                                                | Means                                             |
| ---------- | --------------------------------------------------- | ------------------------------------------------- |
| In Klaviyo | `lime-soft` pill, `forest` dot and text             | The draft is in Klaviyo                           |
| Planned    | `mist` pill, `lime` dot with a forest ring          | In the plan, not created yet                      |
| Working    | `mist` pill, `stone` dot                            | Agents are on it. The word is the step: Designing |
| Needs you  | `signal-soft` pill, `signal` dot, `signal-ink` text | The owner must do something                       |

- 36 px tall, 14 px side padding, 14 px text, weight 600, 8 px dot.
- Always a word with the dot. Never a dot alone, never color alone.
- A pill is not a button. If the owner can act, put a button next to it.
- Do not invent new statuses or colors. Map a new state onto one of these four.
- You provide: which of the four, and the word for a Working step.

### DayStrip

The day strip shows the 15 days of a plan in one row, so the owner sees the rhythm of sends at a glance.

- Fifteen equal cells, 6 px apart. Each has a one-letter weekday (12 px, `stone`) above a 44 px tall cell with `radius-sm` (12) and the day number (15 px, weight 600).
- No email that day: `mist` cell, `stone` number.
- Planned: `lime` cell, `forest` number.
- In Klaviyo: `forest` cell, white number.
- A small legend sits above the strip, with a dot and a word for each state. The cell also has a text title for screen readers.
- A cell with an email opens that email. A `mist` cell does nothing.
- Always 15 days. Do not use it for a month or a week.
- You provide: the first date, and the state of each day.

### StepCard

Step cards sit at the bottom of the lime onboarding panel and show the five steps, which one you are on, and which are done.

- Five cards in one row, 10 px apart, each at least 116 px tall with 16 px padding and a 20 px radius. A 30 px numbered circle on top, a one-word name at the bottom (17 px, weight 600).
- To do: `lime-tile` card, circle with a 1.5 px `forest` outline.
- Now: `white` card, `ink` text, `forest` filled circle with a white number. Only one card is Now.
- Done: `lime-tile` card, `forest` filled circle with a white check.
- Names are one word: Store, Brand, Klaviyo, Discount, Rivals.
- A done step can be clicked to go back. A step ahead cannot.
- Progress is saved after every step. Coming back opens the step that is Now.
- You provide: the step names and which one is current.

### Progress

Progress is how every long job is shown: a title, one bar, and the list of steps in plain words with the current one marked.

- Use it whenever work takes more than a second or two: planning 15 days, creating an email, reading a store, connecting Klaviyo.
- Title: what is being made, in `heading`: Creating your email, Planning 15 days.
- Bar: 10 px tall, fully round, `mist` track, `forest` fill. It moves per finished step. It never fakes movement.
- Steps: a 32 px circle and a sentence in past tense when done, present tense when running. Done is a `lime` circle with a forest check. Now is a `forest` circle with a lime dot and bold text. Next is a `mist` circle and `stone` text. Each row also says Done, Now or Next in words.
- Step text comes from the real job steps. Write them for a store owner: Wrote the words, not copy_generation complete.
- The owner can leave the page. Coming back shows the same progress.
- When a step fails, that row turns into the error state (see EmptyState) with the reason and a Try again button. Finished steps stay done.
- No bare spinner, no percentage, no time estimate you cannot keep.
- You provide: the title and the list of steps with their state.

### EmptyState

Empty and error states are cards with very few words and exactly one button that fixes the situation.

**Empty** (nothing here yet)

- Centered in the card: a title in `title` size, two to four words, and one forest button. Nothing else. No illustration, no paragraph.
- The button does the thing that fills the screen: No plan yet → Plan next 15 days. No codes yet → Add a code.

**Error** (something failed)

- Left aligned: a 44 px `signal-soft` circle with a `signal-ink` mark, a `heading` that says what happened, one sentence in `stone` that says what it means and what to do, and one forest button.
- Say the real reason in the owner's words: Klaviyo key stopped working. The store site did not answer. This code ended on 30 Nov.
- Say what is safe when it matters: Your emails are safe.
- Never: Something went wrong, Oops, an error code alone, a stack trace, or a red full-page screen.
- If nothing can be done by the owner, the button is Try again, and the reason is still shown.

Every screen needs both states designed before it ships.

You provide: the title, and for an error the reason sentence and the fixing action.
