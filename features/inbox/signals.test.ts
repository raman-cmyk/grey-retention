// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clickableHost, inboxSignal, linksIn } from './signals'

const confirmHtml = `<p>Almost there!</p>
  <a href="https://manage.kmail-lists.com/subscriptions/unsubscribe?a=1">Unsubscribe</a>
  <a href="https://manage.kmail-lists.com/subscriptions/subscribe?a=1&amp;c=2" style="background:#000">Confirm subscription</a>`

describe('inboxSignal', () => {
  it('finds a double-opt-in confirmation and its confirm link, never the unsubscribe link', () => {
    expect(
      inboxSignal({
        subject: 'Please confirm your subscription',
        text: 'One more step',
        html: confirmHtml
      })
    ).toEqual({
      signal: 'opt_in',
      confirmUrl:
        'https://manage.kmail-lists.com/subscriptions/subscribe?a=1&c=2'
    })
  })

  it('still flags a confirmation without a usable link, for a person', () => {
    expect(
      inboxSignal({
        subject: 'Verify your email',
        text: '',
        html: '<a href="http://x.test/confirm">Confirm</a>'
      })
    ).toEqual({ signal: 'opt_in', confirmUrl: null })
  })

  it('finds a notice that we were unsubscribed', () => {
    expect(
      inboxSignal({
        subject: 'You have been unsubscribed',
        text: 'Sorry to see you go',
        html: null
      })
    ).toEqual({ signal: 'unsubscribed' })
  })

  it('leaves an ordinary newsletter alone', () => {
    expect(
      inboxSignal({
        subject: 'Spring layers are here',
        text: 'Shop the drop',
        html: '<a href="https://x.test/unsubscribe">Unsubscribe</a>'
      })
    ).toBeNull()
  })

  it('leaves win-back, sunset and welcome-offer newsletters alone', () => {
    for (const email of [
      {
        subject: 'We miss you',
        text: "We'd be sorry to see you go, so here's 20% off your next order."
      },
      {
        subject: 'Is this goodbye?',
        text: "If we don't hear back, you'll be removed from our list next week."
      },
      {
        subject: 'Still interested?',
        text: 'You will be unsubscribed unless you click below.'
      },
      {
        subject: 'One more step to your perfect look',
        text: 'Activate my discount'
      },
      { subject: 'Welcome to the club', text: 'Here is 10% off with code HI10' }
    ])
      expect(
        inboxSignal({
          ...email,
          html: '<a href="https://ctrk.klclick.com/l/abc">Activate my discount</a>'
        }),
        email.subject
      ).toBeNull()
  })

  it('still finds a confirmation that offers a discount, and a link whose words sit in a span', () => {
    expect(
      inboxSignal({
        subject: 'Confirm your email to get 10% off',
        text: 'Almost there.',
        html: '<a href="https://manage.kmail-lists.com/s/a"><span style="color:#fff">Yes, subscribe me</span></a>'
      })
    ).toEqual({
      signal: 'opt_in',
      confirmUrl: 'https://manage.kmail-lists.com/s/a'
    })
  })

  it('keeps a link in a clean form, also when written in capitals', () => {
    expect(
      inboxSignal({
        subject: 'Please confirm your subscription',
        text: '',
        html: '<a href="HTTPS://Northwind.COM/confirm?x=1">Confirm</a>'
      })
    ).toEqual({
      signal: 'opt_in',
      confirmUrl: 'https://northwind.com/confirm?x=1'
    })
  })

  it('reads links quickly, also from hostile HTML', () => {
    const started = Date.now()
    linksIn('<a href="'.repeat(100_000))
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('clickableHost', () => {
  const brand = {
    domain: 'northwind.com',
    senders: ['mailer.northwind-news.com']
  }
  it('trusts the brand, its senders and well-known email services only', () => {
    expect(clickableHost('https://northwind.com/confirm', brand)).toBe(
      'northwind.com'
    )
    expect(clickableHost('https://shop.northwind.com/c', brand)).toBe(
      'shop.northwind.com'
    )
    expect(clickableHost('https://x.mailer.northwind-news.com/c', brand)).toBe(
      'x.mailer.northwind-news.com'
    )
    expect(clickableHost('https://manage.kmail-lists.com/s', brand)).toBe(
      'manage.kmail-lists.com'
    )
    expect(
      clickableHost(
        'https://northwind.us12.list-manage.com/subscribe/confirm',
        brand
      )
    ).toBe('northwind.us12.list-manage.com')
    for (const url of [
      'https://evil.test/confirm',
      'https://northwind.com.evil.test/confirm',
      'https://evilnorthwind.com/confirm',
      'http://northwind.com/confirm',
      'https://user:pw@northwind.com/confirm',
      'not a url'
    ])
      expect(clickableHost(url, brand), url).toBeNull()
  })
})
