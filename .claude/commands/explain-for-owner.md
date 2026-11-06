---
description: Explain a feature, PR, or change to the product owner in plain, non-technical English with concrete examples.
argument-hint: <feature, PR number, branch, or file>
---

Explain **$ARGUMENTS** to the product owner.

The owner runs a Klaviyo email agency. He is not a developer and English is his second language. He wants direct answers with examples, not frameworks or jargon.

1. Look at the real code, PR or diff first (for a PR use `gh api repos/grey-retention/grey-retention/pulls/<n>` and the branch diff). Do not guess.
2. Write the explanation in this shape:
   - **What it does** — one or two sentences.
   - **How a user sees it** — a short walk-through from a brand owner's point of view, for example "The owner opens Calendar, clicks Tuesday, writes 'Black Friday early access', and GROS drafts three subject lines."
   - **What is real and what is simulated** — say clearly if Klaviyo, Shopify, AI or email are fake/fixture in this flow.
   - **What is not done yet** — bullet list of gaps.
   - **Decision needed from you** — only if there is one, as a direct question.
3. No code blocks, no file paths unless asked. Keep it under 250 words.
