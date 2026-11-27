// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cutBlocks } from '@/features/design-engine/blocks'
import {
  blueprint,
  gridSection,
  section
} from '@/features/design-engine/fixtures'
import type { SwapBrand } from '@/features/design-engine/swap'

vi.mock('server-only', () => ({}))
vi.mock('./actions', () => ({ setLayoutHidden: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => null }))
const { drawInBrand, previewWords, readLibraryScreen } =
  await import('./screen-read')
const { LibraryScreen } = await import('./screen')

const brand: SwapBrand = {
  name: 'Fernhill Tea',
  site: 'https://fernhill.example/',
  ink: '#1f2a24',
  background: '#ffffff',
  accent: '#2f6f4f',
  dark: '#1b3a2c',
  headingFont: 'Georgia',
  bodyFont: 'Arial',
  logo: null,
  photos: []
}

describe('the block library screen (DES-ENGINE-004b)', () => {
  it('draws a block in the brand’s look with the brand’s words only, never the source’s', () => {
    const source = blueprint({
      sections: [
        section({
          items: [...section().items.slice(1)]
        }),
        gridSection(2)
      ]
    })
    const [hero] = cutBlocks(source).blocks
    const html = drawInBrand(hero!.blueprint, brand, [
      {
        id: 'p1',
        title: 'Hill green',
        price: '$14.00',
        url: 'https://fernhill.example/p/1',
        photo: null
      }
    ])
    expect(html).toBeTruthy()
    expect(html).toContain('New from Fernhill Tea')
    expect(html).not.toContain('Some words for the test')
    expect(html).not.toMatch(/example\.com/)
    // Blanked words never reach the screen either.
    expect(html).not.toMatch(/\bXxxx\b/)
  })

  it('writes preview words from the brand’s name and products', () => {
    expect(previewWords('Fernhill Tea', ['Hill green']).headline).toEqual([
      'New from Fernhill Tea',
      'Hill green'
    ])
  })

  it('says the library is off, with the switch off', async () => {
    expect(
      await readLibraryScreen({ tenantId: 't', tenantRole: 'owner' }, {})
    ).toEqual({ ok: false, on: false })
    const html = renderToStaticMarkup(
      <LibraryScreen view={{ ok: false, on: false }} />
    )
    expect(html).toContain('The block library is not turned on yet')
  })

  it('shows each kind with how often a layout is used, yours marked, the hide button for managers only', () => {
    const view = {
      ok: true as const,
      on: true as const,
      manager: true,
      brandName: 'Fernhill Tea',
      total: 2,
      kinds: [
        {
          kind: 'hero' as const,
          count: 2,
          shown: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              kind: 'hero' as const,
              uses: 28,
              brands: 4,
              yours: false,
              hidden: false,
              html: '<p>one</p>'
            },
            {
              id: '00000000-0000-4000-8000-000000000002',
              kind: 'hero' as const,
              uses: 1,
              brands: 0,
              yours: true,
              hidden: true,
              html: '<p>two</p>'
            }
          ]
        }
      ]
    }
    const html = renderToStaticMarkup(<LibraryScreen view={view} />)
    expect(html).toContain('Heroes (2)')
    expect(html).toContain('Used 28 times · by 4 brands')
    expect(html).toContain('Used 1 time · Yours · Not used for your emails')
    expect(html).toContain('Don’t use this layout')
    expect(html).toContain('Use it again')
    const staff = renderToStaticMarkup(
      <LibraryScreen view={{ ...view, manager: false }} />
    )
    expect(staff).not.toContain('Don’t use this layout')
  })
})
