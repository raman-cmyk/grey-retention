import { escape } from '@/features/rendering/renderer'
import { formatBrandDateTimeWithZone } from '@/lib/brand-time'
import {
  minimumLeadMinutes,
  waiting,
  type BatchItem,
  type ShownItem
} from './weekly'

/**
 * The Sunday approval email (APR-002, VISION Step 5): one email per client
 * per week with every campaign still open for approval (phone screenshot,
 * date, offer, audience, warnings) and two kinds of button, Approve all
 * and Change. Each button opens a confirmation page in the app; the
 * approval itself happens there, on a button the owner presses, so a mail
 * scanner that opens links can never approve anything (see links.ts).
 * Replies are not read yet, so the email does not invite them.
 *
 * Hidden by decision D17 (RET-002): there is no weekly approval. Nothing
 * routes to, schedules or imports this code; it is kept for reference.
 */
export type ApprovalEmailItem = BatchItem & {
  /** The 375px screenshot QA made (Step 4), reused here. */
  screenshotUrl?: string
}

export type ApprovalEmail = {
  subject: string
  preheader: string
  html: string
  text: string
  /** The emails the email shows, at their revisions. */
  shown: ShownItem[]
}

/** An https URL with no spaces or control characters, or null. */
const checkedHttps = (url: string) => {
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password
      ? u.toString()
      : null
  } catch {
    return null
  }
}

const oneLine = (text: string, max: number) =>
  text
    .replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max)

/** The emails still open for approval: waiting, and far enough ahead. */
export function stillOpen<T extends BatchItem>(
  items: readonly T[],
  now: Date
): T[] {
  return (waiting(items) as T[]).filter(
    (i) => Date.parse(i.sendAt) - now.getTime() >= minimumLeadMinutes * 60_000
  )
}

export function weeklyApprovalEmail(input: {
  brandName: string
  /** e.g. "the week of 10 November". */
  weekLabel: string
  timezone: string
  items: readonly ApprovalEmailItem[]
  now: Date
  /** When the links stop working, shown in the store timezone. */
  linksExpireAt: string
  /** Signs the Approve all link for exactly the emails shown. */
  approveAllUrl: (shown: ShownItem[]) => string
  /** Signs one Change link; called once per email. */
  changeUrl: (item: ApprovalEmailItem) => string
}): ApprovalEmail {
  const items = stillOpen(input.items, input.now)
  if (!items.length)
    throw new Error('Nothing is waiting for approval, so no email is sent.')
  const shown = items.map(({ campaignId, revision }) => ({
    campaignId,
    revision
  }))
  const approveAll = checkedHttps(input.approveAllUrl(shown))
  if (!approveAll) throw new Error('The approve link must be https.')
  // One Change link per email, made once and used in both parts.
  const changes = items.map((i) => {
    const url = checkedHttps(input.changeUrl(i))
    if (!url) throw new Error('Change links must be https.')
    return url
  })
  const brand = oneLine(input.brandName, 80)
  const week = oneLine(input.weekLabel, 60)
  const count = items.length
  const emails = `${count} email${count === 1 ? '' : 's'}`
  const subject = `${emails} for ${week}: approve or change`
  const preheader =
    'Approve all, or change any one. Nothing is sent until you approve.'
  const when = (i: BatchItem) =>
    formatBrandDateTimeWithZone(i.sendAt, input.timezone) ?? i.sendAt
  const until =
    formatBrandDateTimeWithZone(input.linksExpireAt, input.timezone) ??
    input.linksExpireAt
  const font = 'font-family:Arial,Helvetica,sans-serif'
  // A bulletproof button: the padded link is the tap target; the cell's
  // bgcolor keeps the colour in Outlook, which ignores padding on links.
  const button = (href: string, label: string, primary: boolean) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:4px 0"><tr><td bgcolor="${primary ? '#1a1a1a' : '#ffffff'}" style="border:1px solid #1a1a1a;border-radius:6px"><a href="${escape(href)}" style="display:inline-block;padding:14px 24px;${font};font-size:15px;font-weight:700;line-height:18px;color:${primary ? '#ffffff' : '#1a1a1a'};text-decoration:none;border-radius:6px">${label}</a></td></tr></table>`
  const p = (style: string, html: string) =>
    `<p style="margin:0 0 6px;${font};${style}">${html}</p>`
  const cards = items
    .map((i, n) => {
      const shot = i.screenshotUrl ? checkedHttps(i.screenshotUrl) : null
      const words = [
        p('font-size:13px;color:#555555', escape(when(i))),
        p('font-size:17px;font-weight:700;color:#1a1a1a', escape(i.subject)),
        p(
          'font-size:14px;color:#1a1a1a',
          `Offer: ${escape(i.offer ?? 'none')}`
        ),
        p('font-size:14px;color:#1a1a1a', `Sends to: ${escape(i.segment)}`),
        ...i.warnings.map((w) =>
          p('font-size:13px;color:#8a4b00', `Check: ${escape(w)}`)
        ),
        button(changes[n], 'Change this email', false)
      ].join('')
      // Two cells instead of a float, which Outlook ignores.
      return `<tr><td style="padding:16px 24px;border-top:1px solid #e6e6e6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top">${words}</td>${shot ? `<td valign="top" width="128" style="padding-left:12px"><img src="${escape(shot)}" alt="Phone preview of ${escape(i.subject)}" width="116" style="display:block;width:116px;height:auto;border:1px solid #e6e6e6;border-radius:6px"></td>` : ''}</tr></table></td></tr>`
    })
    .join('')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;padding:0;background:#f4f4f2"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f2"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:600px;max-width:100%"><tr><td style="padding:28px 24px 8px"><p style="margin:0 0 8px;${font};font-size:22px;font-weight:700;color:#1a1a1a">${escape(brand)}: ${emails} for ${escape(week)}</p><p style="margin:0 0 16px;${font};font-size:15px;line-height:1.5;color:#1a1a1a">Approve them all, or change any one. Nothing is sent until you approve.</p>${button(approveAll, 'Approve all', true)}</td></tr>${cards}<tr><td style="padding:16px 24px 28px;${font};font-size:12px;line-height:1.6;color:#555555">These links work until ${escape(until)}, and each one works once.</td></tr></table></td></tr></table></body></html>`
  const text = [
    `${brand}: ${emails} for ${week}`,
    'Approve them all, or change any one. Nothing is sent until you approve.',
    '',
    `Approve all: ${approveAll}`,
    '',
    ...items.flatMap((i, n) => [
      `${when(i)} · ${oneLine(i.subject, 200)}`,
      `Offer: ${oneLine(i.offer ?? 'none', 200)} · Sends to: ${oneLine(i.segment, 200)}`,
      ...i.warnings.map((w) => `Check: ${oneLine(w, 300)}`),
      `Change: ${changes[n]}`,
      ''
    ]),
    `These links work until ${until}, and each one works once.`
  ].join('\n')
  return {
    subject,
    preheader,
    html,
    text,
    shown
  }
}
