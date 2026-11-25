import {
  button,
  classic,
  columns,
  fonts,
  footerRow,
  img,
  link,
  linked,
  logoRow,
  para,
  row,
  says,
  textCss,
  textRow
} from './kit'

/**
 * DES-ENGINE-001 golden set, the 20 **library-shaped** emails: what the
 * Inspiration inbox captures most (grids, long stories, offers, launches),
 * built the classic way, one table row per section. Made up for the test:
 * no client or competitor content, no real brand (D8).
 */

const card = (o: {
  w: number
  color: string
  title: string
  price: string
  font?: string
  old?: string
  btn?: boolean
}) =>
  `${linked(link('p'), img(o.w, o.w, o.color, o.title))}<p style="margin:12px 0 4px;${textCss({ font: o.font, size: 15, line: 20, weight: 700, color: '#222222', align: 'center' })}">${o.title}</p><p style="margin:0;${textCss({ font: o.font, size: 14, line: 20, color: '#555555', align: 'center' })}">${o.old ? `<span style="text-decoration:line-through;color:#999999">${o.old}</span> ` : ''}${o.price}</p>${o.btn ? `<div style="height:12px;line-height:12px;font-size:0">&nbsp;</div>${button({ label: 'Add', bg: '#222222', size: 13, pad: '8px 20px' })}` : ''}`

const heading = (
  words: string,
  pad: string,
  size = 26,
  font: string = fonts.arial,
  color = '#111111'
) =>
  textRow(words, pad, {
    font,
    size,
    line: Math.round(size * 1.25),
    weight: 700,
    color,
    align: 'center'
  })

const body = (
  words: string,
  pad: string,
  font: string = fonts.arial,
  align: 'left' | 'center' = 'center'
) => textRow(words, pad, { font, size: 16, line: 24, color: '#444444', align })

export const libraryEmails: { id: string; title: string; html: string }[] = [
  {
    id: 'lib-01-grid-2col',
    title: 'Two-column product grid',
    html: classic({
      title: 'New in',
      rows: [
        logoRow(),
        row(img(600, 320, '#c9b8a6', 'New arrivals')),
        heading('New in this week', '36px 40px 8px'),
        body(para(1, 22), '0 60px 28px'),
        row(
          columns(
            [
              {
                width: 260,
                html: card({
                  w: 260,
                  color: '#d8cfc4',
                  title: 'Linen throw',
                  price: '$48.00'
                })
              },
              {
                width: 260,
                html: card({
                  w: 260,
                  color: '#b7c4b0',
                  title: 'Clay mug',
                  price: '$22.00'
                })
              }
            ],
            20
          ),
          'padding:0 30px 28px'
        ),
        row(
          columns(
            [
              {
                width: 260,
                html: card({
                  w: 260,
                  color: '#e3d5c0',
                  title: 'Oat candle',
                  price: '$30.00'
                })
              },
              {
                width: 260,
                html: card({
                  w: 260,
                  color: '#c4cdd6',
                  title: 'Stone tray',
                  price: '$36.00'
                })
              }
            ],
            20
          ),
          'padding:0 30px 32px'
        ),
        row(
          button({ label: 'Shop all new', bg: '#2b2b2b' }),
          'padding:0 0 40px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'lib-02-grid-3col',
    title: 'Three-column product grid',
    html: classic({
      title: 'Best sellers',
      page: '#ebe7e1',
      rows: [
        logoRow({ width: 120, height: 36 }),
        heading('Our best sellers', '28px 40px 6px', 30, fonts.georgia),
        body(para(2, 16), '0 70px 24px', fonts.georgia),
        row(
          columns(
            [
              {
                width: 172,
                html: card({
                  w: 172,
                  color: '#cdbfae',
                  title: 'Wool socks',
                  price: '$14',
                  font: fonts.georgia
                })
              },
              {
                width: 172,
                html: card({
                  w: 172,
                  color: '#a9b7a0',
                  title: 'Cedar soap',
                  price: '$9',
                  font: fonts.georgia
                })
              },
              {
                width: 172,
                html: card({
                  w: 172,
                  color: '#d9c7a3',
                  title: 'Honey jar',
                  price: '$12',
                  font: fonts.georgia
                })
              }
            ],
            12
          ),
          'padding:0 30px 32px'
        ),
        row(
          button({
            label: 'See every best seller',
            bg: '#7a4b2a',
            radius: 24,
            font: fonts.georgia
          }),
          'padding:0 0 36px'
        ),
        footerRow({ font: fonts.georgia })
      ]
    })
  },
  {
    id: 'lib-03-long-story',
    title: 'Long story from the founder',
    html: classic({
      title: 'A note',
      rows: [
        logoRow({ align: 'left', pad: '28px 40px' }),
        row(img(520, 300, '#b5a491', 'The workshop'), 'padding:0 40px'),
        textRow('How it started', '32px 40px 12px', {
          font: fonts.georgia,
          size: 28,
          line: 34,
          color: '#1d1d1d'
        }),
        ...[3, 4, 5, 6, 7].map((s) =>
          textRow(para(s, 40 + s * 3), '0 40px 18px', {
            font: fonts.georgia,
            size: 17,
            line: 28,
            color: '#3a3a3a'
          })
        ),
        textRow(
          'With care,<br><strong>Sam, founder</strong>',
          '8px 40px 36px',
          { font: fonts.georgia, size: 17, line: 28, color: '#3a3a3a' }
        ),
        footerRow({ font: fonts.georgia })
      ]
    })
  },
  {
    id: 'lib-04-offer-code',
    title: 'Offer with a code box',
    html: classic({
      title: 'Offer',
      page: '#fbeee6',
      rows: [
        logoRow({ color: '#7a2e1f' }),
        row(
          `<p style="margin:0 0 8px;${textCss({ size: 13, line: 18, weight: 700, color: '#7a2e1f', align: 'center', extra: 'letter-spacing:3px;text-transform:uppercase' })}">This weekend only</p><p style="margin:0;${textCss({ size: 64, line: 70, weight: 700, color: '#7a2e1f', align: 'center' })}">25% off</p><p style="margin:12px 0 0;${textCss({ size: 18, line: 26, color: '#5a3b32', align: 'center' })}">${para(8, 14)}</p>`,
          'background:#f7d9c9;padding:44px 40px',
          ' bgcolor="#f7d9c9"'
        ),
        row(
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr><td style="border:2px solid #7a2e1f;padding:14px 36px;${textCss({ size: 22, line: 28, weight: 700, color: '#7a2e1f', align: 'center', extra: 'letter-spacing:4px' })}">USE CODE WEEKEND25</td></tr></table>`,
          'padding:32px 0 24px'
        ),
        row(
          button({
            label: 'Shop the offer',
            bg: '#7a2e1f',
            radius: 0,
            pad: '16px 44px'
          }),
          'padding:0 0 40px'
        ),
        textRow(para(9, 26), '0 50px 32px', {
          size: 12,
          line: 18,
          color: '#8a7068',
          align: 'center'
        }),
        footerRow()
      ]
    })
  },
  {
    id: 'lib-05-launch',
    title: 'Launch with a feature row',
    html: classic({
      title: 'Launch',
      rows: [
        logoRow(),
        row(img(600, 380, '#9fb3c8', 'The new range')),
        heading('Meet the new range', '40px 40px 10px', 34),
        body(para(10, 26), '0 56px 26px'),
        row(
          button({ label: 'Discover it', bg: '#1f3a5a' }),
          'padding:0 0 40px'
        ),
        row(
          columns(
            [
              { width: 260, html: img(260, 260, '#c8d4e0', 'Detail') },
              {
                width: 260,
                html: `<p style="margin:40px 0 10px;${textCss({ size: 22, line: 28, weight: 700, color: '#1f3a5a' })}">Made to last</p><p style="margin:0 0 18px;${textCss({ size: 15, line: 23, color: '#444444' })}">${para(11, 30)}</p>${button({ label: 'Read more', bg: '#ffffff', color: '#1f3a5a', border: '2px solid #1f3a5a', align: 'left', pad: '10px 24px', size: 14 })}`
              }
            ],
            20
          ),
          'padding:0 30px 40px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'lib-06-zigzag',
    title: 'Zigzag of pictures and words',
    html: classic({
      title: 'Three ways',
      body: '#fffdf8',
      rows: [
        logoRow({ bg: '#fffdf8' }),
        heading('Three ways to use it', '20px 40px 30px', 28, fonts.helvetica),
        ...[0, 1, 2].map((i) => {
          const pic = {
            width: 250,
            html: img(250, 200, ['#e2c9a6', '#a6c9b8', '#c9a6c4'][i]!, 'Idea')
          }
          const words = {
            width: 270,
            html: `<p style="margin:30px 0 10px;${textCss({ font: fonts.helvetica, size: 20, line: 26, weight: 700, color: '#222222' })}">${says(20 + i, 3)}</p><p style="margin:0;${textCss({ font: fonts.helvetica, size: 15, line: 22, color: '#555555' })}">${para(21 + i, 24)}</p>`
          }
          return row(
            columns(i % 2 ? [words, pic] : [pic, words], 20),
            'padding:0 30px 30px'
          )
        }),
        row(
          button({ label: 'Shop now', bg: '#333333', font: fonts.helvetica }),
          'padding:10px 0 40px'
        ),
        footerRow({ font: fonts.helvetica })
      ]
    })
  },
  {
    id: 'lib-07-announcement',
    title: 'Announcement bar and icon row',
    html: classic({
      title: 'Free delivery',
      rows: [
        row(
          `Free delivery on orders over $50`,
          `background:#1e1e1e;padding:10px 20px;${textCss({ size: 13, line: 18, color: '#ffffff', align: 'center', weight: 700 })}`,
          ' bgcolor="#1e1e1e"'
        ),
        logoRow(),
        row(img(600, 300, '#d4c2b0', 'This season')),
        heading(says(30, 5), '32px 40px 24px', 28),
        row(
          columns(
            [0, 1, 2].map((i) => ({
              width: 160,
              html: `${img(56, 56, '#444444', 'Icon', 'margin:0 auto')}<p style="margin:10px 0 0;${textCss({ size: 14, line: 20, color: '#333333', align: 'center' })}">${says(31 + i, 3)}</p>`
            })),
            20
          ),
          'padding:0 40px 36px'
        ),
        row(
          button({ label: 'Start shopping', bg: '#b4462b' }),
          'padding:0 0 40px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'lib-08-reviews',
    title: 'Review strip',
    html: classic({
      title: 'Reviews',
      page: '#eef1ee',
      rows: [
        logoRow({ color: '#204030' }),
        heading(
          'What people say',
          '24px 40px 24px',
          26,
          fonts.trebuchet,
          '#204030'
        ),
        row(
          columns(
            [0, 1, 2].map((i) => ({
              width: 168,
              style: 'background:#f3f6f3;padding:16px',
              html: `<p style="margin:0 0 8px;${textCss({ font: fonts.trebuchet, size: 16, line: 20, color: '#c9a227', align: 'center' })}">★★★★★</p><p style="margin:0 0 10px;${textCss({ font: fonts.trebuchet, size: 14, line: 21, color: '#333333', align: 'center' })}">“${para(40 + i, 14)}”</p><p style="margin:0;${textCss({ font: fonts.trebuchet, size: 12, line: 16, weight: 700, color: '#204030', align: 'center' })}">${says(45 + i, 1)}</p>`
            })),
            0
          ),
          'padding:0 30px 32px'
        ),
        row(
          button({
            label: 'Read all reviews',
            bg: '#204030',
            font: fonts.trebuchet
          }),
          'padding:0 0 40px'
        ),
        footerRow({ font: fonts.trebuchet })
      ]
    })
  },
  {
    id: 'lib-09-category-tiles',
    title: 'Category tiles',
    html: classic({
      title: 'Shop by room',
      rows: [
        logoRow(),
        heading('Shop by room', '16px 40px 24px', 30),
        ...[0, 1].map((r) =>
          row(
            columns(
              [0, 1].map((c) => ({
                width: 265,
                html: `${linked(link('c'), img(265, 200, ['#d1c3b4', '#b4c3d1', '#c3d1b4', '#d1b4c3'][r * 2 + c]!, 'Room'))}<p style="margin:0;padding:12px 0;${textCss({ size: 15, line: 20, weight: 700, color: '#222222', align: 'center', extra: 'letter-spacing:1px;text-transform:uppercase' })}">${says(50 + r * 2 + c, 1)}</p>`
              })),
              10
            ),
            'padding:0 30px 16px'
          )
        ),
        row('&nbsp;', 'height:20px;font-size:0;line-height:0'),
        footerRow()
      ]
    })
  },
  {
    id: 'lib-10-faq',
    title: 'Questions and answers',
    html: classic({
      title: 'Questions',
      rows: [
        logoRow(),
        heading('Your questions', '20px 40px 20px', 28),
        ...[0, 1, 2, 3].map((i) =>
          textRow(
            `<strong style="color:#111111">${says(60 + i, 6)}?</strong><br>${para(64 + i, 26)}`,
            '0 50px 22px',
            { size: 15, line: 23, color: '#4a4a4a' }
          )
        ),
        row(
          button({ label: 'Ask us anything', bg: '#3c5a78' }),
          'padding:8px 0 40px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'lib-11-steps',
    title: 'Three steps',
    html: classic({
      title: 'How it works',
      body: '#f8f4ee',
      page: '#f8f4ee',
      rows: [
        logoRow({ bg: '#f8f4ee' }),
        heading('How it works', '20px 40px 28px', 30, fonts.helvetica),
        row(
          columns(
            [1, 2, 3].map((n) => ({
              width: 160,
              html: `<p style="margin:0 0 8px;${textCss({ font: fonts.helvetica, size: 40, line: 44, weight: 700, color: '#c0703a', align: 'center' })}">${n}</p><p style="margin:0 0 6px;${textCss({ font: fonts.helvetica, size: 16, line: 22, weight: 700, color: '#222222', align: 'center' })}">${says(70 + n, 2)}</p><p style="margin:0;${textCss({ font: fonts.helvetica, size: 14, line: 20, color: '#555555', align: 'center' })}">${para(74 + n, 10)}</p>`
            })),
            20
          ),
          'padding:0 40px 36px'
        ),
        row(
          button({
            label: 'Get started',
            bg: '#c0703a',
            radius: 30,
            font: fonts.helvetica
          }),
          'padding:0 0 44px'
        ),
        footerRow({ font: fonts.helvetica, bg: '#efe8de' })
      ]
    })
  },
  {
    id: 'lib-12-before-after',
    title: 'Before and after',
    html: classic({
      title: 'Before and after',
      rows: [
        logoRow(),
        heading('See the difference', '16px 40px 24px', 28),
        row(
          columns(
            [
              {
                width: 265,
                html: `${img(265, 300, '#bbbbbb', 'Before')}<p style="margin:10px 0 0;${textCss({ size: 13, line: 18, weight: 700, color: '#666666', align: 'center' })}">BEFORE</p>`
              },
              {
                width: 265,
                html: `${img(265, 300, '#e0c9a0', 'After')}<p style="margin:10px 0 0;${textCss({ size: 13, line: 18, weight: 700, color: '#666666', align: 'center' })}">AFTER</p>`
              }
            ],
            10
          ),
          'padding:0 30px 28px'
        ),
        body(para(80, 24), '0 60px 28px'),
        row(button({ label: 'Try it', bg: '#222222' }), 'padding:0 0 40px'),
        footerRow()
      ]
    })
  },
  {
    id: 'lib-13-newsletter',
    title: 'Newsletter with subheads and links',
    html: classic({
      title: 'Journal',
      rows: [
        logoRow({ align: 'left', pad: '24px 40px' }),
        row(img(600, 260, '#a7b8a0', 'Journal')),
        textRow('The journal', '32px 40px 6px', {
          font: fonts.georgia,
          size: 32,
          line: 38,
          color: '#1a1a1a'
        }),
        textRow(`Issue 12 · ${says(90, 3)}`, '0 40px 26px', {
          size: 13,
          line: 18,
          color: '#888888',
          extra: 'letter-spacing:1px'
        }),
        ...[0, 1, 2].flatMap((i) => [
          textRow(says(91 + i, 4), '0 40px 8px', {
            font: fonts.georgia,
            size: 21,
            line: 28,
            weight: 700,
            color: '#1a1a1a'
          }),
          textRow(
            `${para(94 + i, 34)} <a href="${link('read')}" style="color:#2f6b4f;text-decoration:underline">Read the full story</a> and <strong>${says(97 + i, 3, false)}</strong>.`,
            '0 40px 26px',
            { font: fonts.georgia, size: 16, line: 26, color: '#3a3a3a' }
          )
        ]),
        footerRow({ font: fonts.georgia })
      ]
    })
  },
  {
    id: 'lib-14-dark-offer',
    title: 'Offer on a dark band',
    html: classic({
      title: 'Last chance',
      page: '#111111',
      body: '#1b1b1b',
      rows: [
        logoRow({ bg: '#1b1b1b', color: '#f0f0f0' }),
        row(
          `<p style="margin:0 0 10px;${textCss({ size: 14, line: 20, weight: 700, color: '#e5c07b', align: 'center', extra: 'letter-spacing:4px' })}">LAST CHANCE</p><p style="margin:0 0 14px;${textCss({ size: 44, line: 50, weight: 700, color: '#ffffff', align: 'center' })}">Up to 40% off</p><p style="margin:0 0 28px;${textCss({ size: 17, line: 26, color: '#cccccc', align: 'center' })}">${para(100, 16)}</p>${button({ label: 'Shop the sale', bg: '#1b1b1b', color: '#e5c07b', border: '2px solid #e5c07b', radius: 0 })}`,
          'padding:40px 50px 48px'
        ),
        row(img(600, 280, '#3a3a3a', 'Sale')),
        footerRow({ bg: '#111111', color: '#999999' })
      ]
    })
  },
  {
    id: 'lib-15-product-feature',
    title: 'One product, picture beside words',
    html: classic({
      title: 'Spotlight',
      rows: [
        logoRow(),
        row(
          columns(
            [
              { width: 300, html: img(300, 360, '#d6c0aa', 'The product') },
              {
                width: 240,
                html: `<p style="margin:60px 0 8px;${textCss({ size: 12, line: 16, weight: 700, color: '#9a6a3a', extra: 'letter-spacing:2px;text-transform:uppercase' })}">Spotlight</p><p style="margin:0 0 12px;${textCss({ size: 28, line: 32, weight: 700, color: '#222222' })}">The everyday tote</p><p style="margin:0 0 14px;${textCss({ size: 15, line: 22, color: '#555555' })}">${para(110, 18)}</p><p style="margin:0 0 20px;${textCss({ size: 20, line: 26, weight: 700, color: '#222222' })}">$64.00</p>${button({ label: 'Buy now', bg: '#9a6a3a', align: 'left', pad: '12px 28px' })}`
              }
            ],
            20
          ),
          'padding:0 20px 40px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'lib-16-colour-hero',
    title: 'Launch on a colour band',
    html: classic({
      title: 'Coming soon',
      rows: [
        logoRow({ bg: '#2d4a3e', color: '#ffffff', pad: '20px 0' }),
        row(
          `<p style="margin:0 0 16px;${textCss({ font: fonts.helvetica, size: 48, line: 52, weight: 700, color: '#f5efe6', align: 'center' })}">${says(120, 3)}</p><p style="margin:0 0 30px;${textCss({ font: fonts.helvetica, size: 18, line: 27, color: '#d9e4de', align: 'center' })}">${para(121, 20)}</p>${button({ label: 'Be the first', bg: '#f5efe6', color: '#2d4a3e', radius: 40, font: fonts.helvetica, pad: '16px 40px' })}`,
          'background:#2d4a3e;padding:60px 50px 70px',
          ' bgcolor="#2d4a3e"'
        ),
        row(
          columns(
            [0, 1, 2].map((i) => ({
              width: 200,
              html: img(
                200,
                200,
                ['#cfd8d2', '#b9c6bf', '#a3b4ab'][i]!,
                'Preview'
              )
            })),
            0
          )
        ),
        footerRow({ font: fonts.helvetica })
      ]
    })
  },
  {
    id: 'lib-17-ugc-grid',
    title: 'Customer photo grid',
    html: classic({
      title: 'Seen at home',
      rows: [
        logoRow(),
        heading('Seen in your homes', '16px 40px 8px', 26),
        body(para(130, 14), '0 60px 24px'),
        ...[0, 1].map((r) =>
          row(
            columns(
              [0, 1, 2].map((c) => ({
                width: 176,
                html: img(
                  176,
                  176,
                  [
                    '#d8c8b8',
                    '#b8c8d8',
                    '#c8d8b8',
                    '#d8b8c8',
                    '#c8b8d8',
                    '#b8d8c8'
                  ][r * 3 + c]!,
                  'Customer photo'
                )
              })),
              6
            ),
            'padding:0 33px 6px'
          )
        ),
        row(
          button({ label: 'Share yours', bg: '#555555' }),
          'padding:24px 0 40px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'lib-18-four-categories',
    title: 'Free shipping bar and four categories',
    html: classic({
      title: 'Shop by kind',
      rows: [
        logoRow(),
        row(
          `Free shipping on everything this week · <a href="${link('ship')}" style="color:#ffffff;text-decoration:underline">Details</a>`,
          `background:#5b7f6e;padding:12px 20px;${textCss({ size: 14, line: 20, color: '#ffffff', align: 'center' })}`,
          ' bgcolor="#5b7f6e"'
        ),
        heading('Find your favourite', '32px 40px 24px', 26),
        row(
          columns(
            [0, 1, 2, 3].map((i) => ({
              width: 125,
              html: `${linked(link('k'), img(125, 125, ['#e7d3c1', '#c1d3e7', '#d3e7c1', '#e7c1d3'][i]!, 'Kind', 'border-radius:62px'))}<p style="margin:8px 0 0;${textCss({ size: 13, line: 18, weight: 700, color: '#333333', align: 'center' })}">${says(140 + i, 1)}</p>`
            })),
            10
          ),
          'padding:0 30px 36px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'lib-19-gift-guide',
    title: 'Gift guide with two grids',
    html: classic({
      title: 'Gift guide',
      page: '#f4efe9',
      rows: [
        logoRow(),
        row(img(600, 240, '#c79a7e', 'Gift guide')),
        heading('Gifts under $30', '30px 40px 20px', 24, fonts.georgia),
        row(
          columns(
            [0, 1, 2].map((i) => ({
              width: 172,
              html: card({
                w: 172,
                color: ['#e0cbb8', '#cbb8e0', '#b8e0cb'][i]!,
                title: says(150 + i, 2),
                price: `$${18 + i * 4}.00`,
                font: fonts.georgia
              })
            })),
            12
          ),
          'padding:0 30px 28px'
        ),
        heading('Gifts for the home', '8px 40px 20px', 24, fonts.georgia),
        row(
          columns(
            [0, 1].map((i) => ({
              width: 260,
              html: card({
                w: 260,
                color: ['#d9c3a5', '#a5bfd9'][i]!,
                title: says(160 + i, 2),
                price: `$${42 + i * 8}.00`,
                font: fonts.georgia,
                btn: true
              })
            })),
            20
          ),
          'padding:0 30px 36px'
        ),
        footerRow({ font: fonts.georgia })
      ]
    })
  },
  {
    id: 'lib-20-letter-social',
    title: 'Short letter with social links',
    html: classic({
      title: 'Thank you',
      rows: [
        logoRow({ align: 'left', pad: '32px 48px 16px' }),
        ...[170, 171, 172].map((s) =>
          textRow(para(s, 30), '0 48px 18px', {
            font: fonts.verdana,
            size: 14,
            line: 22,
            color: '#333333'
          })
        ),
        textRow('Talk soon,<br>The team', '6px 48px 30px', {
          font: fonts.verdana,
          size: 14,
          line: 22,
          color: '#333333'
        }),
        row(
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>${[0, 1, 2, 3].map((i) => `<td style="padding:0 6px">${linked(link(`social${i}`), img(32, 32, '#555555', 'Social'))}</td>`).join('')}</tr></table>`,
          'padding:0 0 28px'
        ),
        footerRow({ font: fonts.verdana, bg: '#ffffff' })
      ]
    })
  }
]
