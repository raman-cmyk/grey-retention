import { describe, expect, it } from 'vitest'
import type { KlaviyoState } from '@/features/settings/read-model'
import {
  klaviyoWorking,
  openPlace,
  setupFlow,
  siteDomain,
  type SetupRecords
} from './flow-model'

const none: SetupRecords = {
  domain: null,
  confirmedSite: null,
  klaviyoWorking: false,
  maxDiscountSet: false,
  following: 0,
  rivalsSkipped: false,
  finished: false
}
const all: SetupRecords = {
  domain: 'cedarlane.example',
  confirmedSite: 'cedarlane.example',
  klaviyoWorking: true,
  maxDiscountSet: true,
  following: 1,
  rivalsSkipped: false,
  finished: false
}
const done = (records: SetupRecords) =>
  setupFlow(records)
    .steps.filter((s) => s.done)
    .map((s) => s.key)

const klaviyo = (extra: Partial<KlaviyoState> = {}): KlaviyoState => ({
  status: 'connected',
  mode: 'sample',
  keyStatus: null,
  accountLabel: 'Sample account',
  keyHint: 'pk_abc••••wxyz',
  checkedAt: null,
  missingLater: [],
  ...extra
})

describe('siteDomain (as the database reads a website)', () => {
  it('lowers it and drops www.', () => {
    expect(siteDomain('  WWW.CedarLane.example ')).toBe('cedarlane.example')
    expect(siteDomain('shop.cedarlane.example')).toBe('shop.cedarlane.example')
  })
  it('trims only spaces, as the database does, and takes at most 253 characters', () => {
    expect(siteDomain('\tcedarlane.example')).toBeNull()
    expect(siteDomain('cedarlane.example\n')).toBeNull()
    const long = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`
    expect(long).toHaveLength(253)
    expect(siteDomain(long)).toBe(long)
    expect(siteDomain(`e${long}`)).toBeNull()
  })
  it('is no website for an address, a bare word, numbers or nothing', () => {
    for (const bad of [
      'https://cedarlane.example',
      'cedarlane.example/shop',
      'cedarlane',
      '10.0.0.1',
      'cedar lane.example',
      '-cedar.example',
      '',
      null,
      undefined
    ])
      expect(siteDomain(bad)).toBeNull()
  })
})

describe('klaviyoWorking (the Settings rule)', () => {
  it('is connected and not refused', () => {
    expect(klaviyoWorking(klaviyo(), false)).toBe(true)
    expect(klaviyoWorking(klaviyo({ status: 'expired' }), false)).toBe(false)
    expect(klaviyoWorking(klaviyo({ status: 'none' }), false)).toBe(false)
    expect(
      klaviyoWorking(klaviyo({ mode: 'live', keyStatus: 'refused' }), true)
    ).toBe(false)
    expect(klaviyoWorking(null, false)).toBe(false)
  })
  it('with live keys on, needs a real key, not the sample connection', () => {
    expect(klaviyoWorking(klaviyo(), true)).toBe(false)
    expect(
      klaviyoWorking(klaviyo({ mode: 'live', keyStatus: 'active' }), true)
    ).toBe(true)
  })
})

describe('setupFlow (UI-ONBa)', () => {
  it('starts at Store with nothing saved', () => {
    const flow = setupFlow(none)
    expect(flow.steps.map((s) => s.name)).toEqual([
      'Store',
      'Brand',
      'Klaviyo',
      'Discount',
      'Rivals'
    ])
    expect(flow.current).toBe(0)
    expect(flow.allDone).toBe(false)
    expect(openPlace(flow)).toBe('store')
  })

  it('needs a real website for Store, and the same one confirmed for Brand', () => {
    expect(done({ ...none, domain: 'not a site' })).toEqual([])
    expect(done({ ...none, domain: 'cedarlane.example' })).toEqual(['store'])
    expect(
      done({
        ...none,
        domain: 'WWW.CedarLane.example',
        confirmedSite: 'cedarlane.example'
      })
    ).toEqual(['store', 'brand'])
    // The owner changed the website: Brand needs a new look.
    expect(
      done({
        ...none,
        domain: 'cedarlane-two.example',
        confirmedSite: 'cedarlane.example'
      })
    ).toEqual(['store'])
    // A mark without a saved website counts for nothing.
    expect(done({ ...none, confirmedSite: 'cedarlane.example' })).toEqual([])
  })

  it('takes Rivals as done by following a brand or by the skip', () => {
    expect(done({ ...all, following: 0 })).not.toContain('rivals')
    expect(done({ ...all, following: 0, rivalsSkipped: true })).toContain(
      'rivals'
    )
    expect(done({ ...all, following: 3 })).toContain('rivals')
  })

  it('opens the first step not done, never a done one ahead of it', () => {
    // Klaviyo connected in Settings first, and Rivals skipped: Brand is Now.
    const flow = setupFlow({
      ...none,
      domain: 'cedarlane.example',
      klaviyoWorking: true,
      rivalsSkipped: true
    })
    expect(flow.current).toBe(1)
    expect(openPlace(flow)).toBe('brand')
    expect(openPlace(flow, 'rivals')).toBe('brand')
    expect(openPlace(flow, 'klaviyo')).toBe('brand')
    expect(openPlace(flow, 'finish')).toBe('brand')
  })

  it('lets a done step and Now be opened again, and ignores an unknown one', () => {
    const flow = setupFlow({ ...all, maxDiscountSet: false })
    expect(flow.current).toBe(3)
    expect(openPlace(flow, 'store')).toBe('store')
    expect(openPlace(flow, 'klaviyo')).toBe('klaviyo')
    expect(openPlace(flow, 'discount')).toBe('discount')
    expect(openPlace(flow, 'rivals')).toBe('discount')
    expect(openPlace(flow, 'nonsense')).toBe('discount')
    expect(openPlace(flow, null)).toBe('discount')
  })

  it('says whether the workspace has its onboarding row', () => {
    expect(setupFlow(none).tracked).toBe(false)
    expect(setupFlow({ ...none, tracked: true }).tracked).toBe(true)
  })

  it('opens the finish once every step is done, any step still open', () => {
    const flow = setupFlow(all)
    expect(flow.allDone).toBe(true)
    expect(flow.current).toBe(5)
    expect(flow.finished).toBe(false)
    expect(openPlace(flow)).toBe('finish')
    expect(openPlace(flow, 'rivals')).toBe('rivals')
    expect(setupFlow({ ...all, finished: true }).finished).toBe(true)
  })
})

describe('a waiting Brand (the website is read first, VISION section 5)', () => {
  const reading: SetupRecords = {
    ...none,
    domain: 'cedarlane.example',
    siteReading: true
  }
  const waiting = (records: SetupRecords) =>
    setupFlow(records)
      .steps.filter((s) => s.waiting)
      .map((s) => s.key)

  it('is not Now while the website is read: Now moves to the next step', () => {
    const flow = setupFlow(reading)
    expect(waiting(reading)).toEqual(['brand'])
    expect(flow.steps[1]!.done).toBe(false)
    expect(flow.current).toBe(2)
    expect(openPlace(flow)).toBe('klaviyo')
    // Brand can be opened (to see the read); a step ahead of Now cannot.
    expect(openPlace(flow, 'brand')).toBe('brand')
    expect(openPlace(flow, 'store')).toBe('store')
    expect(openPlace(flow, 'discount')).toBe('klaviyo')
  })

  it('lets the steps after it be done meanwhile', () => {
    const flow = setupFlow({
      ...reading,
      klaviyoWorking: true,
      maxDiscountSet: true
    })
    expect(flow.current).toBe(4)
    expect(openPlace(flow)).toBe('rivals')
    expect(openPlace(flow, 'klaviyo')).toBe('klaviyo')
    expect(openPlace(flow, 'discount')).toBe('discount')
  })

  it('withholds the finish while it waits, with every other step done', () => {
    const flow = setupFlow({ ...all, confirmedSite: null, siteReading: true })
    expect(waiting({ ...all, confirmedSite: null, siteReading: true })).toEqual(
      ['brand']
    )
    expect(flow.current).toBe(5)
    expect(flow.allDone).toBe(false)
    expect(openPlace(flow)).toBe('finish')
    expect(openPlace(flow, 'brand')).toBe('brand')
  })

  it('is Now again once the website was read, or its read failed', () => {
    const flow = setupFlow({
      ...reading,
      siteReading: false,
      klaviyoWorking: true,
      maxDiscountSet: true
    })
    expect(waiting({ ...reading, siteReading: false })).toEqual([])
    expect(flow.current).toBe(1)
    expect(openPlace(flow)).toBe('brand')
  })

  it('never waits without a website, or once confirmed', () => {
    expect(waiting({ ...none, siteReading: true })).toEqual([])
    expect(setupFlow({ ...none, siteReading: true }).current).toBe(0)
    expect(waiting({ ...all, siteReading: true })).toEqual([])
    expect(setupFlow({ ...all, siteReading: true }).allDone).toBe(true)
  })
})
