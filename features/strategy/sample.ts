import type { PulseInput } from './pulse'

/**
 * A synthetic store for building the strategy agents before lane B's
 * readers land (D8: neutral names, no real data). Dates are relative to
 * `start` so the sample always describes "the next 15 days".
 */
export function sampleStore(start: string): PulseInput {
  const day = (offset: number) => {
    const d = new Date(`${start}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + offset)
    return d.toISOString().slice(0, 10)
  }
  return {
    brand: {
      name: 'Cedar Lane (sample)',
      industry: 'home',
      timezone: 'Australia/Melbourne',
      currency: 'AUD',
      maxDiscountPercent: 20
    },
    start,
    codes: [
      { code: 'WELCOME15', percent: 15, expiresOn: null },
      { code: 'CANDLE10', percent: 10, expiresOn: day(6) },
      { code: 'BIGSALE40', percent: 40, expiresOn: null },
      { code: 'SPRING20', percent: 20, expiresOn: day(-3) }
    ],
    products: [
      {
        id: 'p-linen-throw',
        title: 'Linen throw',
        price: 129,
        launchedOn: day(-10),
        unitsSold30d: 42,
        stock: 60
      },
      {
        id: 'p-cedar-candle',
        title: 'Cedar candle',
        price: 39,
        launchedOn: null,
        unitsSold30d: 118,
        stock: 7
      },
      {
        id: 'p-stone-vase',
        title: 'Stone vase',
        price: 89,
        launchedOn: null,
        unitsSold30d: 31,
        stock: 0
      },
      {
        id: 'p-oak-tray',
        title: 'Oak tray',
        price: 59,
        launchedOn: day(4),
        unitsSold30d: 0,
        stock: 40
      },
      {
        id: 'p-wool-cushion',
        title: 'Wool cushion',
        price: 69,
        launchedOn: null,
        unitsSold30d: 25,
        stock: null
      }
    ],
    results: [
      {
        title: 'New linen, made slowly',
        sentOn: day(-9),
        clicks: 212,
        revenue: 2140
      },
      {
        title: 'The candle that sold out',
        sentOn: day(-16),
        clicks: 340,
        revenue: 3920
      },
      { title: 'Studio notes', sentOn: day(-23), clicks: 96, revenue: 410 }
    ],
    dates: [
      { date: day(3), name: 'Studio open day', kind: 'event' },
      { date: day(9), name: 'Public holiday', kind: 'blackout' },
      { date: day(12), name: 'End of month', kind: 'event' },
      { date: day(20), name: 'Outside the window', kind: 'event' }
    ]
  }
}
