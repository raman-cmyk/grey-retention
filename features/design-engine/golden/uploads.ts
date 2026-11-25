import { picture } from './pictures'
import {
  button,
  classic,
  columns,
  fonts,
  footerRow,
  img,
  link,
  linkButton,
  linked,
  logoRow,
  para,
  row,
  says,
  textCss,
  textRow
} from './kit'

/**
 * DES-ENGINE-001 golden set, the 20 **upload-shaped** emails: HTML as
 * other tools write it, the kind an owner uploads (MJML-style stacked
 * divs, Outlook conditional tables, hybrid columns, `<font>` tags and
 * attributes, style sheets instead of inline styles, sliced pictures,
 * cards with borders and corners, a 640 px email…). Made up for the test:
 * no client or competitor content, no real brand (D8).
 */

const doc = (
  title: string,
  bodyHtml: string,
  o: { head?: string; bg?: string } = {}
) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0}${o.head ?? ''}</style></head><body style="margin:0;padding:0;background:${o.bg ?? '#ffffff'}">${bodyHtml}</body></html>`

/** An MJML-style section: a centred 600 px div with a table inside. */
const mjSection = (inner: string, bg = '#ffffff', pad = '20px 0') =>
  `<div style="background:${bg};margin:0 auto;max-width:600px"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:${bg};width:100%"><tbody><tr><td style="direction:ltr;font-size:0px;padding:${pad};text-align:center">${inner}</td></tr></tbody></table></div>`

/** An MJML-style column: an inline-block div at a share of the width. */
const mjColumn = (share: number, inner: string) =>
  `<!--[if mso | IE]><td style="vertical-align:top;width:${Math.round(600 * share)}px"><![endif]--><div class="mj-column" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:${share * 100}%"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top" width="100%"><tbody>${inner}</tbody></table></div><!--[if mso | IE]></td><![endif]-->`

const mjText = (
  words: string,
  t: Parameters<typeof textCss>[0],
  pad = '10px 25px'
) =>
  `<tr><td align="${t.align ?? 'left'}" style="font-size:0px;padding:${pad};word-break:break-word"><div style="${textCss(t)}">${words}</div></td></tr>`

const mjImage = (w: number, h: number, color: string, pad = '10px 25px') =>
  `<tr><td align="center" style="font-size:0px;padding:${pad};word-break:break-word"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px"><tbody><tr><td style="width:${w}px"><img alt="" height="${h}" src="${picture(w, h, color)}" style="border:0;display:block;outline:none;text-decoration:none;height:${h}px;width:100%;font-size:13px" width="${w}"></td></tr></tbody></table></td></tr>`

const mjButton = (label: string, bg: string, pad = '10px 25px') =>
  `<tr><td align="center" style="font-size:0px;padding:${pad};word-break:break-word"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%"><tr><td align="center" bgcolor="${bg}" role="presentation" style="border:none;border-radius:3px;cursor:auto;mso-padding-alt:10px 25px;background:${bg}" valign="middle"><a href="${link('mj')}" style="display:inline-block;background:${bg};color:#ffffff;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:13px;font-weight:normal;line-height:120%;margin:0;text-decoration:none;text-transform:none;padding:10px 25px;mso-padding-alt:0px;border-radius:3px" target="_blank">${label}</a></td></tr></table></td></tr>`

export const uploadEmails: { id: string; title: string; html: string }[] = [
  {
    id: 'up-01-mjml',
    title: 'MJML-style stacked sections',
    html: doc(
      'Hello',
      `<div style="background:#f0f0f0">${[
        mjSection(`${mjColumn(1, mjImage(160, 48, '#333333'))}`),
        mjSection(
          `${mjColumn(1, `${mjImage(600, 280, '#a9c1d9', '0')}`)}`,
          '#ffffff',
          '0'
        ),
        mjSection(
          mjColumn(
            1,
            `${mjText('Hello from the studio', { font: fonts.helvetica, size: 30, line: 36, weight: 700, color: '#222222', align: 'center' }, '20px 25px 6px')}${mjText(para(200, 26), { font: fonts.helvetica, size: 15, line: 22, color: '#555555', align: 'center' })}${mjButton('Visit the studio', '#d95f43')}`
          )
        ),
        mjSection(
          `${mjColumn(0.5, `${mjImage(250, 250, '#e8c9a8')}${mjText(says(201, 3), { font: fonts.helvetica, size: 16, line: 22, weight: 700, color: '#222222', align: 'center' })}`)}${mjColumn(0.5, `${mjImage(250, 250, '#a8c9e8')}${mjText(says(202, 3), { font: fonts.helvetica, size: 16, line: 22, weight: 700, color: '#222222', align: 'center' })}`)}`
        ),
        mjSection(
          mjColumn(
            1,
            mjText(
              `Sample Store · <a href="${link('unsubscribe')}" style="color:#888888">Unsubscribe</a>`,
              {
                font: fonts.helvetica,
                size: 11,
                line: 16,
                color: '#888888',
                align: 'center'
              }
            )
          ),
          '#f7f7f7'
        )
      ].join('')}</div>`,
      {
        bg: '#f0f0f0',
        head: '@media only screen and (min-width:480px){.mj-column{max-width:100%}}'
      }
    )
  },
  {
    id: 'up-02-outlook-center',
    title: 'Outlook conditional tables inside a center tag',
    html: doc(
      'Outlook',
      `<center style="width:100%;background:#e9ecef"><!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]--><div style="max-width:600px;margin:0 auto"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:auto"><tr><td style="padding:20px 0;text-align:center">${img(180, 50, '#1b4965', 'Logo', 'margin:auto')}</td></tr><tr><td style="background:#ffffff">${img(600, 300, '#62b6cb', 'Hero', 'width:100%;max-width:600px;height:auto;margin:auto')}</td></tr><tr><td style="background:#ffffff;padding:30px 40px 10px;${textCss({ size: 26, line: 32, weight: 700, color: '#1b4965', align: 'center' })}">${says(210, 5)}</td></tr><tr><td style="background:#ffffff;padding:0 40px 30px;${textCss({ size: 15, line: 23, color: '#555555', align: 'center' })}">${para(211, 28)}</td></tr><tr><td style="background:#ffffff;padding:0 0 40px">${button({ label: 'Read more', bg: '#1b4965', radius: 6 })}</td></tr><tr><td height="20" style="font-size:20px;line-height:20px">&nbsp;</td></tr><tr><td style="padding:0 40px 30px;${textCss({ size: 12, line: 18, color: '#777777', align: 'center' })}">You are receiving this email because you signed up. <a href="${link('unsubscribe')}" style="color:#777777">Unsubscribe</a></td></tr></table></div><!--[if mso]></td></tr></table><![endif]--></center>`,
      { bg: '#e9ecef' }
    )
  },
  {
    id: 'up-03-klaviyo-like',
    title: 'Nested tables with div text and inline-block link buttons',
    html: classic({
      title: 'Nested',
      page: '#f7f3ef',
      rows: [
        row(
          `<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:18px 30px">${img(130, 36, '#3d2c29', 'Logo')}</td></tr></table>`
        ),
        row(
          `<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:0 30px"><div style="${textCss({ size: 34, line: 40, weight: 700, color: '#3d2c29' })}"><p style="margin:0">${says(220, 4)}</p></div><div style="${textCss({ size: 16, line: 25, color: '#4f4441' })}"><p style="margin:14px 0 0">${para(221, 30)}</p><p style="margin:14px 0 0">${para(222, 22)}</p></div></td></tr></table>`,
          'padding:10px 0 24px'
        ),
        row(
          `<div style="text-align:left;padding:0 30px">${linkButton({ label: 'Shop the edit', bg: '#3d2c29', radius: 2 })}</div>`,
          'padding:0 0 30px'
        ),
        row(img(600, 340, '#cbb7a5', 'Edit')),
        footerRow({ bg: '#f7f3ef' })
      ]
    })
  },
  {
    id: 'up-04-hybrid-columns',
    title: 'Hybrid inline-block columns',
    html: classic({
      title: 'Hybrid',
      rows: [
        logoRow(),
        textRow(says(230, 4), '10px 30px 20px', {
          size: 24,
          line: 30,
          weight: 700,
          color: '#222222',
          align: 'center'
        }),
        row(
          `<div style="font-size:0;text-align:center">${[0, 1, 2]
            .map(
              (i) =>
                `<div style="display:inline-block;width:180px;vertical-align:top;font-size:14px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:0 5px">${img(170, 170, ['#e4b7a0', '#a0e4b7', '#b7a0e4'][i]!, 'Item')}</td></tr><tr><td style="padding:10px 5px 0;${textCss({ size: 14, line: 20, color: '#333333', align: 'center' })}">${says(231 + i, 2)}<br><strong>$${20 + i * 5}</strong></td></tr></table></div>`
            )
            .join('')}</div>`,
          'padding:0 30px 30px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'up-05-font-tags',
    title: 'Old-style font tags and attributes',
    html: doc(
      'Old style',
      `<table width="100%" bgcolor="#dddddd" cellpadding="0" cellspacing="0"><tr><td align="center"><table width="600" bgcolor="#ffffff" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" height="80" valign="middle"><font face="Georgia, serif" size="6" color="#7b2d26"><b>Sample Store</b></font></td></tr><tr><td><img src="${picture(600, 250, '#c08a5b')}" width="600" height="250" border="0" alt="Banner" style="display:block"></td></tr><tr><td align="left" style="padding:25px"><font face="Verdana, sans-serif" size="2" color="#333333">${para(240, 40)}<br><br>${para(241, 30)}</font></td></tr><tr><td align="center" style="padding:0 0 25px"><table cellpadding="12" cellspacing="0" border="0" bgcolor="#7b2d26"><tr><td align="center"><a href="${link('old')}" style="color:#ffffff;text-decoration:none"><font face="Verdana, sans-serif" size="3" color="#ffffff"><b>ORDER NOW</b></font></a></td></tr></table></td></tr><tr><td align="center" bgcolor="#eeeeee" style="padding:15px"><font face="Verdana, sans-serif" size="1" color="#666666">Sample Store · <a href="${link('unsubscribe')}">Unsubscribe</a></font></td></tr></table></td></tr></table>`
    )
  },
  {
    id: 'up-06-default-margins',
    title: 'Headings and paragraphs with the browser’s own margins',
    html: classic({
      title: 'Margins',
      rows: [
        row(
          `<h1 style="font-family:${fonts.arial};color:#202020;text-align:center">${says(250, 4)}</h1><p style="font-family:${fonts.arial};font-size:15px;color:#444444;text-align:center">${para(251, 30)}</p><h2 style="font-family:${fonts.arial};color:#202020;text-align:center">${says(252, 3)}</h2><p style="font-family:${fonts.arial};font-size:15px;color:#444444;text-align:center">${para(253, 26)}</p>`,
          'padding:10px 40px'
        ),
        row(img(520, 260, '#9db4a8', 'Picture'), 'padding:0 40px 30px'),
        footerRow()
      ]
    })
  },
  {
    id: 'up-07-cards-hr',
    title: 'Rounded bordered cards and a rule',
    html: classic({
      title: 'Cards',
      page: '#eef0f4',
      body: '#eef0f4',
      rows: [
        logoRow({ bg: '#eef0f4' }),
        row(
          `<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d6dae2;border-radius:12px"><tr><td style="padding:28px 30px;${textCss({ size: 22, line: 28, weight: 700, color: '#1f2a44' })}">${says(260, 5)}</td></tr><tr><td style="padding:0 30px 24px;${textCss({ size: 15, line: 23, color: '#4a5468' })}">${para(261, 32)}</td></tr><tr><td style="padding:0 30px 28px">${button({ label: 'Open', bg: '#3355cc', radius: 8, align: 'left', pad: '10px 26px' })}</td></tr></table>`,
          'padding:0 30px 20px'
        ),
        row(
          `<hr style="border:0;border-top:1px solid #c5cad6;margin:0">`,
          'padding:10px 30px 20px'
        ),
        row(
          `<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d6dae2;border-radius:12px"><tr><td style="padding:24px 30px;${textCss({ size: 15, line: 23, color: '#4a5468' })}">${para(262, 40)}</td></tr></table>`,
          'padding:0 30px 30px'
        ),
        footerRow({ bg: '#eef0f4' })
      ]
    })
  },
  {
    id: 'up-08-border-dividers',
    title: 'Dividers drawn as cell borders',
    html: classic({
      title: 'Borders',
      rows: [
        logoRow(),
        ...[0, 1, 2].map((i) =>
          row(
            `<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #dddddd;padding:22px 0;${textCss({ size: 15, line: 22, color: '#333333' })}"><strong style="font-size:18px;color:#111111">${says(270 + i, 3)}</strong><br>${para(273 + i, 22)}</td></tr></table>`,
            'padding:0 40px'
          )
        ),
        row(
          `<div style="border-top:1px solid #dddddd;height:1px;line-height:1px;font-size:0">&nbsp;</div>`,
          'padding:0 40px 30px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'up-09-640-wide',
    title: 'A 640 px email',
    html: classic({
      title: 'Wide',
      width: 640,
      rows: [
        logoRow(),
        row(img(640, 300, '#b0a8c8', 'Wide')),
        textRow(says(280, 5), '30px 50px 10px', {
          size: 28,
          line: 34,
          weight: 700,
          color: '#2a2440',
          align: 'center'
        }),
        textRow(para(281, 30), '0 50px 30px', {
          size: 16,
          line: 24,
          color: '#555555',
          align: 'center'
        }),
        row(
          columns(
            [
              { width: 280, html: img(280, 200, '#d0c8e8', 'A') },
              { width: 280, html: img(280, 200, '#c8e8d0', 'B') }
            ],
            20
          ),
          'padding:0 30px 30px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'up-10-stylesheet',
    title: 'Styles in a style sheet, not inline',
    html: doc(
      'Sheet',
      `<div class="page"><div class="wrap"><div class="logo">${img(140, 40, '#0f3d3e', 'Logo')}</div><div class="hero">${img(600, 260, '#7fb7a4', 'Hero')}</div><div class="copy"><h1>${says(290, 4)}</h1><p>${para(291, 30)}</p><a class="btn" href="${link('sheet')}">See more</a></div><div class="foot">Sample Store · <a href="${link('unsubscribe')}">Unsubscribe</a></div></div></div>`,
      {
        bg: '#e4efe9',
        head: `.page{background:#e4efe9;padding:20px 0}.wrap{width:600px;margin:0 auto;background:#ffffff}.logo{padding:20px 30px}.logo img{margin:0}.copy{padding:20px 30px 34px;font-family:Verdana,sans-serif}.copy h1{font-size:24px;line-height:30px;margin:0 0 12px;color:#0f3d3e}.copy p{font-size:14px;line-height:22px;margin:0 0 22px;color:#3c4c48}.btn{display:inline-block;padding:12px 24px;background:#0f3d3e;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;border-radius:20px}.foot{padding:20px;background:#f3f7f5;font:11px/16px Verdana,sans-serif;color:#7a8a86;text-align:center}.foot a{color:#7a8a86}`
      }
    )
  },
  {
    id: 'up-11-plain-letter',
    title: 'A plain letter in paragraphs',
    html: doc(
      'Letter',
      `<div style="max-width:600px;margin:0 auto;padding:30px 20px;font-family:Georgia,serif;font-size:17px;line-height:27px;color:#2b2b2b">${[300, 301, 302, 303, 304].map((s) => `<p style="margin:0 0 18px">${para(s, 30 + (s % 4) * 8)}</p>`).join('')}<p style="margin:0 0 18px">Warmly,<br>Alex</p><p style="margin:0;font-size:12px;line-height:18px;color:#888888">You are receiving this email because you signed up. <a href="${link('unsubscribe')}" style="color:#888888">Unsubscribe</a></p></div>`
    )
  },
  {
    id: 'up-12-sliced-pictures',
    title: 'An email sliced into linked pictures',
    html: classic({
      title: 'Slices',
      rows: [
        row(linked(link('s1'), img(600, 120, '#202020', 'Slice 1'))),
        row(linked(link('s2'), img(600, 360, '#c94f4f', 'Slice 2'))),
        row(
          columns(
            [
              {
                width: 300,
                html: linked(link('s3'), img(300, 220, '#e08f62', 'Slice 3'))
              },
              {
                width: 300,
                html: linked(link('s4'), img(300, 220, '#d7c79e', 'Slice 4'))
              }
            ],
            0
          )
        ),
        row(linked(link('s5'), img(600, 140, '#202020', 'Slice 5'))),
        textRow(
          `Sample Store · <a href="${link('unsubscribe')}" style="color:#999999">Unsubscribe</a>`,
          '20px',
          { size: 11, line: 16, color: '#999999', align: 'center' }
        )
      ]
    })
  },
  {
    id: 'up-13-button-shapes',
    title: 'Pill, outlined and side-by-side buttons',
    html: classic({
      title: 'Buttons',
      rows: [
        logoRow(),
        textRow(says(310, 4), '10px 40px 16px', {
          size: 26,
          line: 32,
          weight: 700,
          color: '#222222',
          align: 'center'
        }),
        textRow(para(311, 24), '0 60px 26px', {
          size: 15,
          line: 22,
          color: '#555555',
          align: 'center'
        }),
        row(
          button({
            label: 'Pill button',
            bg: '#6b4fbb',
            radius: 30,
            pad: '14px 40px'
          }),
          'padding:0 0 18px'
        ),
        row(
          button({
            label: 'Outlined button',
            bg: '#ffffff',
            color: '#6b4fbb',
            border: '2px solid #6b4fbb',
            radius: 6,
            pad: '12px 30px'
          }),
          'padding:0 0 26px'
        ),
        row(
          columns(
            [
              {
                width: 250,
                html: button({
                  label: 'For her',
                  bg: '#333333',
                  pad: '12px 0',
                  radius: 0
                }).replace('margin:0 auto', 'margin:0 auto;width:250px')
              },
              {
                width: 250,
                html: button({
                  label: 'For him',
                  bg: '#333333',
                  pad: '12px 0',
                  radius: 0
                }).replace('margin:0 auto', 'margin:0 auto;width:250px')
              }
            ],
            20
          ),
          'padding:0 40px 36px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'up-14-social-nav',
    title: 'Navigation links and a social icon row',
    html: classic({
      title: 'Links',
      rows: [
        logoRow(),
        row(
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${['New', 'Women', 'Men', 'Home'].map((w) => `<td width="130" align="center" style="width:130px;padding:12px 0;${textCss({ size: 13, line: 18, weight: 700, color: '#222222', align: 'center', extra: 'letter-spacing:1px;text-transform:uppercase' })}"><a href="${link(w.toLowerCase())}" style="color:#222222;text-decoration:none">${w}</a></td>`).join('')}</tr></table>`,
          'padding:0 40px;border-top:1px solid #eeeeee;border-bottom:1px solid #eeeeee'
        ),
        row(img(600, 320, '#b3a294', 'Season')),
        textRow(para(320, 30), '28px 50px 28px', {
          size: 15,
          line: 23,
          color: '#444444',
          align: 'center'
        }),
        row(
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>${[0, 1, 2, 3, 4].map((i) => `<td style="padding:0 8px">${linked(link(`s${i}`), img(28, 28, '#222222', 'Social', 'border-radius:14px'))}</td>`).join('')}</tr></table>`,
          'padding:0 0 26px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'up-15-sale-prices',
    title: 'Grid with old and new prices',
    html: classic({
      title: 'Sale',
      rows: [
        logoRow(),
        textRow(
          '<span style="color:#c0392b">Sale</span> now on',
          '6px 40px 20px',
          { size: 30, line: 36, weight: 700, color: '#222222', align: 'center' }
        ),
        row(
          columns(
            [0, 1, 2].map((i) => ({
              width: 172,
              html: `${img(172, 220, ['#d5b9b2', '#b2c7d5', '#c9d5b2'][i]!, 'Product')}<p style="margin:10px 0 2px;${textCss({ size: 14, line: 19, color: '#222222', align: 'center' })}">${says(330 + i, 2)}</p><p style="margin:0;${textCss({ size: 14, line: 19, align: 'center' })}"><span style="text-decoration:line-through;color:#999999">$${60 + i * 10}</span> <span style="color:#c0392b;font-weight:700">$${40 + i * 6}</span></p>`
            })),
            12
          ),
          'padding:0 30px 30px'
        ),
        row(
          button({ label: 'Shop the sale', bg: '#c0392b' }),
          'padding:0 0 36px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'up-16-header-nav',
    title: 'Header with the logo left and links right',
    html: classic({
      title: 'Header',
      rows: [
        row(
          columns(
            [
              { width: 200, html: img(130, 34, '#123c69', 'Logo') },
              {
                width: 320,
                style: `text-align:right;${textCss({ size: 13, line: 34, color: '#123c69', align: 'right' })}`,
                html: `<a href="${link('shop')}" style="color:#123c69;text-decoration:none">Shop</a> &nbsp; <a href="${link('about')}" style="color:#123c69;text-decoration:none">About</a> &nbsp; <a href="${link('help')}" style="color:#123c69;text-decoration:none">Help</a>`
              }
            ],
            0
          ),
          'padding:20px 40px'
        ),
        row(img(600, 300, '#ac3b61', 'Hero')),
        textRow(says(340, 6), '30px 40px 12px', {
          size: 26,
          line: 32,
          weight: 700,
          color: '#123c69'
        }),
        textRow(para(341, 34), '0 40px 26px', {
          size: 15,
          line: 23,
          color: '#444444'
        }),
        row(
          button({ label: 'Learn more', bg: '#123c69', align: 'left' }),
          'padding:0 40px 40px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'up-17-unitless',
    title: 'Unitless line heights, em sizes and spaced capitals',
    html: classic({
      title: 'Units',
      rows: [
        logoRow(),
        row(
          `<p style="margin:0 0 10px;font-family:${fonts.helvetica};font-size:0.75em;line-height:1.4;letter-spacing:0.3em;text-transform:uppercase;color:#8a6d3b;text-align:center">${says(350, 3)}</p><p style="margin:0 0 14px;font-family:${fonts.helvetica};font-size:2.25em;line-height:1.1;font-weight:700;color:#222222;text-align:center">${says(351, 4)}</p><p style="margin:0;font-family:${fonts.helvetica};font-size:1.05em;line-height:1.6;color:#555555;text-align:center">${para(352, 30)}</p>`,
          'padding:20px 50px 30px'
        ),
        row(
          img(500, 280, '#d7c4a3', 'Picture', 'margin:0 auto'),
          'padding:0 0 30px'
        ),
        footerRow({ font: fonts.helvetica })
      ]
    })
  },
  {
    id: 'up-18-nested-bands',
    title: 'A card on a band with a code box inside',
    html: classic({
      title: 'Bands',
      rows: [
        logoRow(),
        row(
          `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff"><tr><td style="padding:30px;${textCss({ size: 24, line: 30, weight: 700, color: '#2c3e50', align: 'center' })}">${says(360, 4)}</td></tr><tr><td style="padding:0 30px 20px;${textCss({ size: 15, line: 22, color: '#555555', align: 'center' })}">${para(361, 20)}</td></tr><tr><td align="center" style="padding:0 30px 30px"><table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td bgcolor="#fdf2d0" style="background:#fdf2d0;padding:12px 28px;${textCss({ size: 20, line: 26, weight: 700, color: '#2c3e50', align: 'center', extra: 'letter-spacing:3px' })}">CODE SAVE15</td></tr></table></td></tr></table>`,
          'background:#dfe6ec;padding:30px',
          ' bgcolor="#dfe6ec"'
        ),
        row(
          button({ label: 'Use it now', bg: '#2c3e50' }),
          'padding:30px 0 40px'
        ),
        footerRow()
      ]
    })
  },
  {
    id: 'up-19-cellpadding-percent',
    title: 'Cell padding attributes and percentage columns',
    html: doc(
      'Percent',
      `<table width="600" align="center" cellpadding="20" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px auto"><tr><td align="center">${img(150, 40, '#444444', 'Logo', 'margin:0 auto')}</td></tr><tr><td><table width="100%" cellpadding="10" cellspacing="0"><tr><td width="50%" valign="top" style="${textCss({ size: 15, line: 22, color: '#333333' })}"><b>${says(370, 3)}</b><br>${para(371, 24)}</td><td width="50%" valign="top">${img(260, 200, '#a3c4bc', 'Side')}</td></tr></table></td></tr><tr><td align="center" style="${textCss({ size: 12, line: 18, color: '#888888', align: 'center' })}">Sample Store · <a href="${link('unsubscribe')}" style="color:#888888">Unsubscribe</a></td></tr></table>`,
      { bg: '#f4f4f4' }
    )
  },
  {
    id: 'up-20-inline-icons',
    title: 'Icons inside lines of words, bullets and small print',
    html: classic({
      title: 'Inline',
      rows: [
        logoRow(),
        textRow(says(380, 5), '10px 40px 16px', {
          size: 24,
          line: 30,
          weight: 700,
          color: '#222222'
        }),
        ...[381, 382, 383].map((s) =>
          textRow(`• ${para(s, 14)}`, '0 40px 10px', {
            size: 15,
            line: 22,
            color: '#333333'
          })
        ),
        textRow(
          `<img src="${picture(16, 16, '#2e7d32')}" width="16" height="16" alt="" style="vertical-align:middle"> Free returns within 30 days<sup>*</sup>`,
          '10px 40px 24px',
          { size: 15, line: 22, color: '#2e7d32', weight: 700 }
        ),
        row(
          button({ label: 'Shop now', bg: '#222222', align: 'left' }),
          'padding:0 40px 30px'
        ),
        textRow(`<sup>*</sup> ${para(384, 20)}`, '0 40px 30px', {
          size: 11,
          line: 16,
          color: '#888888'
        }),
        footerRow()
      ]
    })
  }
]
