# Brand fonts in designed emails

DST-FONT-001 connects the current workspace's collected brand font files to
the existing studio brief, designer, critic and renderer host allowlist.
This does not turn on paid AI, studio jobs or any live provider.

## Contract

- The worker passes the leased store's sample flag. Only explicit
  `sample: false` loads fonts; samples and omitted flags return no faces.
- The existing `brandFonts` reader scopes reads to the leased tenant and
  current brand website. This change adds no database schema or credential.
- Faces are loaded once per design step, only when a section needs design.
  Coded-only work does not read font assets. Database failures retain the
  existing retry path instead of quietly changing the brand's typeface.
- Faces enter the brief before hashing. Unchanged faces preserve pending
  renders; a changed face invalidates old work and requests a fresh render.
- At most four distinct family/weight/style faces are passed. Family names,
  integer weights from 100 to 900, HTTPS, URL length, standard ports and
  absence of credentials/fragments are checked.

## Supported font hosts

Only exact CDN hostnames already recognized by the site reader are used:
`cdn.shopify.com`, `fonts.gstatic.com`, `use.typekit.net`, `fonts.bunny.net`,
`fast.fonts.net`, `cloud.typography.com` and `fonts.cdnfonts.com`.
Lookalike subdomains and custom/self-hosted domains are excluded, retaining
system-font fallback. This deliberately limits coverage until the browser
renderer has a DNS-pinned asset transport. Hostname spelling is not DNS/IP
validation; this change does not claim to fix the existing renderer's
network-boundary limitations. Its redirect and origin restrictions remain.

## Verification

All new tests use mocked database reads and render ports. They exercise
sample isolation, the leased tenant, read failures, exact CDN filtering,
face limits/deduplication, actual designer briefs, renderer allowlists and
resume behavior after a font change. No font CDN or paid service is called.
A real branded email render and authenticated end-to-end journey remain
live-validation work; unit tests do not prove their visual quality.
