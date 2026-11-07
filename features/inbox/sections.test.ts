// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { maxSections, sectionEmail } from './sections'

/** A Klaviyo-style newsletter: a full-width table around a 600px table. */
const klaviyo = `<!doctype html><html><head><style>.x{color:red}</style></head><body style="margin:0">
<div style="display:none;max-height:0;overflow:hidden">Our spring layers are here &zwnj;&nbsp;&zwnj;&nbsp;</div>
<table width="100%" bgcolor="#f4f4f4" role="presentation"><tr><td align="center">
  <table width="600" role="presentation" style="width:600px">
    <tr><td style="background:#111;color:#fff;padding:8px;font-size:12px">Free shipping over $50</td></tr>
    <tr><td align="center"><a href="https://northwind.example"><img src="https://cdn.northwind.example/logo.png" width="140" alt="Northwind"></a></td></tr>
    <tr><td height="24" style="font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td><a href="https://northwind.example/spring"><img src="https://cdn.northwind.example/hero.jpg" width="600" alt="Spring layers"></a></td></tr>
    <tr><td style="padding:24px"><h1>Spring layers are here</h1><p>Light jackets and overshirts for the days that cannot decide. Made to layer, made to last, and cut for real shoulders.</p></td></tr>
    <tr><td align="center"><table><tr><td bgcolor="#1a73e8" style="border-radius:4px;padding:12px 24px"><a href="https://northwind.example/spring" style="color:#fff">Shop the drop</a></td></tr></table></td></tr>
    <tr><td><table width="100%"><tr>
      <td width="50%"><img src="https://cdn.northwind.example/p1.jpg" width="280" alt="Overshirt"><p>Field overshirt $68</p></td>
      <td width="50%"><img src="https://cdn.northwind.example/p2.jpg" width="280" alt="Jacket"><p>Rain jacket $120</p></td>
    </tr></table></td></tr>
    <tr><td style="font-size:11px;color:#999">Northwind Outdoor, 1 Sample Street. <a href="https://northwind.example/unsubscribe">Unsubscribe</a></td></tr>
  </table>
</td></tr></table>
<img src="https://track.northwind.example/open.gif" width="1" height="1">
</body></html>`

/** A Mailchimp-style template: body table → cell → max-width container. */
const mailchimp = `<html><body><center>
<table id="bodyTable" width="100%"><tr><td id="bodyCell">
  <table class="templateContainer" style="max-width:600px" width="100%"><tbody>
    <tr><td><table><tr><td><img src="https://cdn.cedar.example/header.png" width="600"></td></tr></table></td></tr>
    <tr><td><table><tr><td><h2>Three ways to style linen</h2><p>Roll the sleeves, tuck the front, or wear it open over a tee. Linen gets better every wash, so do not be shy.</p></td></tr></table></td></tr>
  </tbody></table>
</td></tr></table></center></body></html>`

/**
 * MJML 4 output, trimmed to its real structure: one 600px box per
 * mj-section, inline-block column divs, font-size:0 on columns and cells.
 */
const mjSection = (columns: string) =>
  `<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]--><div style="margin:0px auto;max-width:600px;"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;"><tbody><tr><td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;"><!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><![endif]-->${columns}<!--[if mso | IE]></tr></table><![endif]--></td></tr></tbody></table></div><!--[if mso | IE]></td></tr></table><![endif]-->`
const mjColumn = (percent: number, blocks: string) =>
  `<!--[if mso | IE]><td class="" style="vertical-align:top;width:${6 * percent}px;" ><![endif]--><div class="mj-column-per-${percent} mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"><tbody>${blocks}</tbody></table></div><!--[if mso | IE]></td><![endif]-->`
const mjText = (html: string) =>
  `<tr><td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"><div style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:16px;line-height:1.5;text-align:left;color:#000000;">${html}</div></td></tr>`
const mjImage = (src: string, width: number) =>
  `<tr><td align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"><tbody><tr><td style="width:${width}px;"><img alt="" height="auto" src="${src}" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="${width}"></td></tr></tbody></table></td></tr>`
const mjButton = (label: string, href: string) =>
  `<tr><td align="center" vertical-align="middle" style="font-size:0px;padding:10px 25px;word-break:break-word;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"><tbody><tr><td align="center" bgcolor="#414141" role="presentation" style="border:none;border-radius:3px;cursor:auto;mso-padding-alt:10px 25px;background:#414141;" valign="middle"><a href="${href}" style="display:inline-block;background:#414141;color:#ffffff;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:13px;font-weight:normal;line-height:120%;margin:0;text-decoration:none;text-transform:none;padding:10px 25px;mso-padding-alt:0px;border-radius:3px;" target="_blank">${label}</a></td></tr></tbody></table></td></tr>`
const mjml = `<!doctype html><html lang="und" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><title></title><!--[if !mso]><!--><meta http-equiv="X-UA-Compatible" content="IE=edge"><!--<![endif]--><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><style type="text/css">#outlook a { padding:0; } body { margin:0;padding:0; }</style><style type="text/css">@media only screen and (min-width:480px) { .mj-column-per-100 { width:100% !important; max-width: 100%; } .mj-column-per-50 { width:50% !important; max-width: 50%; } }</style></head><body style="word-spacing:normal;"><div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">New linen is in</div><div style="" lang="und" dir="auto">${mjSection(
  mjColumn(100, mjImage('https://cdn.cedar.example/logo.png', 140))
)}${mjSection(
  mjColumn(
    100,
    mjImage('https://cdn.cedar.example/hero.jpg?v=1&w=550', 550) +
      mjText('<h1 style="margin:0">Linen for long days</h1>') +
      mjText(
        'Our linen shirts are washed twice so they are soft from the first wear. Three new colours this week.'
      ) +
      mjButton('Shop linen', 'https://cedar.example/linen')
  )
)}${mjSection(
  mjColumn(
    50,
    mjImage('https://cdn.cedar.example/p1.jpg', 250) + mjText('Linen shirt $49')
  ) +
    mjColumn(
      50,
      mjImage('https://cdn.cedar.example/p2.jpg', 250) +
        mjText('Linen trousers $59')
    )
)}${mjSection(
  mjColumn(
    100,
    mjText(
      '<p style="font-size:11px">Cedar Goods, 1 Sample Lane. <a href="https://cedar.example/u">Unsubscribe</a></p>'
    )
  )
)}</div></body></html>`

const divs = `<html><body><div style="max-width:640px;margin:0 auto">
  <div><img src="https://cdn.juniper.example/banner.jpg" alt="Slow mornings"></div>
  <div><p>Our founder on slow mornings, and why the kettle comes first. A short read for a long weekend.</p></div>
  <div><a href="https://juniper.example/read">Read the story</a></div>
</div></body></html>`

const letter = `<html><body><p>Hi there,</p><p>We have been quiet for a month, and here is why.</p>
<p>Two of us spent the winter rebuilding the workshop.</p><p>— Mara, founder</p></body></html>`

describe('sectionEmail', () => {
  it('cuts a Klaviyo-style email into its rows, without spacers, preheader or tracking pixel', () => {
    const { sections, preheader, textRatio, markedHtml } = sectionEmail(klaviyo)
    expect(sections.map((s) => [s.ordinal, s.kind, s.images])).toEqual([
      [1, 'text', 0],
      [2, 'design', 1],
      [3, 'design', 1],
      [4, 'text', 0],
      [5, 'text', 0],
      [6, 'design', 2],
      [7, 'text', 0]
    ])
    expect(sections[0]!.text).toBe('Free shipping over $50')
    expect(sections[3]!.text).toMatch(/^Spring layers are here Light jackets/)
    expect(sections[4]!.links).toEqual([
      { text: 'Shop the drop', href: 'https://northwind.example/spring' }
    ])
    expect(preheader).toBe('Our spring layers are here')
    expect(textRatio).toBeCloseTo(4 / 7)
    // Each section is marked for the screenshot crop, once.
    for (let n = 1; n <= 7; n++)
      expect(markedHtml.split(`data-gr-section="${n}"`)).toHaveLength(2)
    expect(markedHtml).not.toContain('data-gr-section="8"')
    // The preheader text is not a section's text.
    expect(sections.map((s) => s.text).join(' ')).not.toContain(
      'Our spring layers'
    )
  })

  it('reads MJML output: stacked 600px boxes, font-size:0 columns, side-by-side products', () => {
    const { sections, preheader, markedHtml } = sectionEmail(mjml)
    expect(
      sections.map((s) => [s.kind, s.images, s.wideImages, s.text.slice(0, 20)])
    ).toEqual([
      ['design', 1, 0, ''],
      ['design', 1, 1, ''],
      ['text', 0, 0, 'Linen for long days'],
      ['text', 0, 0, 'Our linen shirts are'],
      ['text', 0, 0, 'Shop linen'],
      ['design', 2, 0, 'Linen shirt $49 Line'],
      ['text', 0, 0, 'Cedar Goods, 1 Sampl']
    ])
    expect(sections[4]!.links).toEqual([
      { text: 'Shop linen', href: 'https://cedar.example/linen' }
    ])
    expect(preheader).toBe('New linen is in')
    for (let n = 1; n <= 7; n++)
      expect(markedHtml.split(`data-gr-section="${n}"`)).toHaveLength(2)
  })

  it('changes nothing in the HTML but the section marks', () => {
    const xhtml = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\r\n<html><body>\r\n<TABLE width="600px"><tr><td><img src="https://cdn.x.example/a.png?v=1&width=600" width="600"></td></tr>\r\n<TR><td style='background:url("https://x.example/b.jpg?a=1&b=2")'>Hello there, friends &amp; family</td></TR></TABLE></body></html>`
    const { sections, markedHtml } = sectionEmail(xhtml)
    expect(sections).toHaveLength(2)
    expect(markedHtml.replace(/ data-gr-section="\d+"/g, '')).toBe(xhtml)
    expect(markedHtml).toContain('<tr data-gr-section="1">')
    expect(markedHtml).toContain('<TR data-gr-section="2">')
  })

  it('counts only truly hidden parts as hidden', () => {
    const html = `<html><body><table width="600">
      <tr><td><img src="https://x.example/h.jpg" style="width:100%"></td></tr>
      <tr><td style="font-size:0.9em">Our story begins with a very small workshop.</td></tr>
      <tr><td style="opacity:0.8">Muted line here</td></tr>
      <tr><td><div style="mso-hide:all">Spring linen is here.</div></td></tr>
      <tr><td style="max-height:0">Not clipped, so shown</td></tr>
      <tr><td style="opacity:0">Gone</td></tr>
      <tr><td style="font-size:0;line-height:0">Zero size words</td></tr>
    </table></body></html>`
    const { sections, preheader } = sectionEmail(html)
    expect(sections.map((s) => s.text)).toEqual([
      '',
      'Our story begins with a very small workshop.',
      'Muted line here',
      'Spring linen is here.',
      'Not clipped, so shown'
    ])
    // A picture stretched to 100% with no width attribute is a banner.
    expect(sections[0]!.wideImages).toBe(1)
    expect(preheader).toBe('Gone')
  })

  it('keeps words with links and bold parts in them as one block', () => {
    const html = `<html><body><table width="600"><tr><td>Hello, it is <b>new linen</b> week. Light, cool and made to last. <a href="https://x.example/l">Shop now</a></td></tr></table></body></html>`
    const { sections } = sectionEmail(html)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.text).toBe(
      'Hello, it is new linen week. Light, cool and made to last. Shop now'
    )
  })

  it('keeps the logo, button and footer around a long letter in stacked boxes', () => {
    const box = (inner: string) =>
      `<div style="margin:0px auto;max-width:600px;"><table width="100%"><tbody><tr><td>${inner}</td></tr></tbody></table></div>`
    const html = `<html><body><div style="background:#fff">${box(
      '<img src="https://x.example/logo.png" width="150">'
    )}${box(`<p>${'We started this company in a garage. '.repeat(40)}</p>`)}${box(
      '<a href="https://x.example/shop">Shop now</a>'
    )}${box('<p>Unsubscribe | Manage preferences</p>')}</div></body></html>`
    expect(sectionEmail(html).sections.map((s) => s.text.slice(0, 12))).toEqual(
      ['', 'We started t', 'Shop now', 'Unsubscribe ']
    )
  })

  it('looks through Mailchimp-style wrappers to the 600px container', () => {
    const { sections } = sectionEmail(mailchimp)
    expect(sections.map((s) => s.kind)).toEqual(['design', 'text'])
    expect(sections[1]!.text).toMatch(/^Three ways to style linen/)
  })

  it('reads div layouts', () => {
    const { sections } = sectionEmail(divs)
    expect(sections.map((s) => [s.kind, s.text.slice(0, 12)])).toEqual([
      ['design', ''],
      ['text', 'Our founder '],
      ['text', 'Read the sto']
    ])
  })

  it('keeps a plain letter as one text section', () => {
    const { sections, textRatio } = sectionEmail(letter)
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ kind: 'text', images: 0 })
    expect(sections[0]!.text).toMatch(
      /^Hi there, We have been quiet .* Mara, founder$/
    )
    expect(textRatio).toBe(1)
  })

  it(`stops at ${maxSections} sections and copes with empty or broken HTML`, () => {
    const many = `<table width="600">${Array.from(
      { length: 60 },
      (_, i) => `<tr><td>Row ${i}</td></tr>`
    ).join('')}</table>`
    expect(sectionEmail(many).sections).toHaveLength(maxSections)
    expect(sectionEmail('').sections).toEqual([])
    expect(sectionEmail('<table><tr><td>Unclosed').sections).toHaveLength(1)
  })

  it('reads hostile HTML quickly', () => {
    const started = Date.now()
    sectionEmail('<table width="600"><tr><td>'.repeat(5_000))
    sectionEmail(`<div>${'<p>x</p>'.repeat(50_000)}</div>`)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
