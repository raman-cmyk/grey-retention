import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  addUpload: vi.fn(async () => ({})),
  deleteUpload: vi.fn(async () => ({})),
  createClient: vi.fn()
}))
vi.mock('./actions', () => ({
  addUpload: mocks.addUpload,
  deleteUpload: mocks.deleteUpload
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import AddOwnEmailError from '@/app/(gros)/inspiration/add/error'
import AddOwnEmailLoading from '@/app/(gros)/inspiration/add/loading'
import { readUploads, type UploadRow, type UploadsView } from './data'
import { UploadsScreen, uploadDetails } from './screen'

afterEach(cleanup)

const row = (over: Partial<UploadRow> = {}): UploadRow => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Autumn edit',
  design: 'own',
  state: 'ready',
  failure: null,
  pictures: 3,
  missing: [],
  at: '2026-11-26T10:00:00Z',
  ...over
})

const view = (over: Partial<Extract<UploadsView, { ok: true }>> = {}) =>
  ({
    ok: true,
    on: true,
    manager: true,
    owner: true,
    uploads: [],
    ...over
  }) as UploadsView

const show = (v: UploadsView) =>
  render(
    <UploadsScreen view={v} requestKey="00000000-0000-4000-8000-0000000000e1" />
  )

describe('Add your own email (DES-ENGINE-003)', () => {
  it('lets the owner upload a file, say whose design it is and name it', () => {
    show(view())
    expect(
      screen.getByRole('heading', { name: 'Add your own email' })
    ).toBeTruthy()
    const file = screen.getByLabelText(
      'Email file (.html or .eml)'
    ) as HTMLInputElement
    expect(file.type).toBe('file')
    expect(file.accept).toContain('.eml')
    const group = screen.getByRole('group', { name: 'Whose design is it?' })
    expect(
      within(group).getByLabelText(/This is my brand’s own design/)
    ).toBeTruthy()
    expect(
      within(group).getByLabelText(/This is another brand’s email/)
    ).toBeTruthy()
    expect(screen.getByLabelText('Name (optional)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add email' })).toBeTruthy()
    expect(
      screen.getByText('No emails added yet. Only your workspace sees them.')
    ).toBeTruthy()
  })

  it('lists the workspace’s own emails with their state, and Delete for a manager', () => {
    show(
      view({
        uploads: [
          row(),
          row({
            id: 'b',
            name: 'Theirs',
            design: 'other',
            state: 'measuring',
            pictures: 0
          }),
          row({ id: 'c', name: 'Broken', state: 'failed', failure: 'too_tall' })
        ]
      })
    )
    const list = screen.getByRole('list', { name: 'Your emails' })
    expect(within(list).getByText('Autumn edit')).toBeTruthy()
    expect(
      within(list).getByText(/Your design · Ready to use · 3 pictures kept/)
    ).toBeTruthy()
    expect(
      within(list).getByText(
        /Another brand’s email · GROS is reading its design/
      )
    ).toBeTruthy()
    expect(within(list).getByText('Reading')).toBeTruthy()
    expect(within(list).getByText(/taller than 16,000 px/)).toBeTruthy()
    expect(within(list).getByText('Needs you')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Delete: / })).toHaveLength(3)
  })

  it('says which pictures cannot be used and what to do', () => {
    expect(
      uploadDetails(
        row({
          missing: [
            {
              host: 'mailer.example',
              count: 2,
              why: 'it is hosted on a site GROS doesn’t load photos from yet'
            }
          ]
        })
      ).at(-1)
    ).toBe(
      '2 pictures on mailer.example can’t be used (it is hosted on a site GROS doesn’t load photos from yet): their sections will be built from library blocks, or add the email as .eml with its pictures inside'
    )
    // Another brand's pictures are never used, so never mentioned.
    expect(
      uploadDetails(
        row({
          design: 'other',
          missing: [{ host: 'x.example', count: 1, why: 'y' }]
        })
      )
    ).toEqual(['Another brand’s email', 'Ready to use'])
  })

  it('shows staff the list only', () => {
    show(view({ manager: false, owner: false, uploads: [row()] }))
    expect(
      screen.getByText(
        'Only the owner or an admin of this workspace can add emails.'
      )
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add email' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull()
  })

  it('says when it is off, and when the list cannot be read', () => {
    show({ ok: false, on: false })
    expect(
      screen.getByRole('heading', { name: 'Not turned on yet' })
    ).toBeTruthy()
    cleanup()
    show({ ok: false, on: true })
    expect(
      screen.getByRole('heading', { name: 'Your emails did not open' })
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Try again' })).toBeTruthy()
  })

  it('has its loading and error states', () => {
    render(<AddOwnEmailLoading />)
    expect(screen.getByText('Opening your emails')).toBeTruthy()
    cleanup()
    render(<AddOwnEmailError retry={() => {}} />)
    expect(
      screen.getByRole('heading', { name: 'This page did not open' })
    ).toBeTruthy()
  })

  it('reads the list with the member’s own session, and the roles', async () => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: async () => ({
        data: [
          {
            id: 'a',
            name: 'Autumn',
            design: 'own',
            state: 'ready',
            failure: null,
            pictures: [{}, {}],
            missing: [{ host: 'x.example', count: 2, why: 'y' }, 'bad'],
            created_at: '2026-11-26T10:00:00Z'
          }
        ],
        error: null
      })
    }
    mocks.createClient.mockResolvedValue({ from: () => q })
    const got = await readUploads(
      { tenantId: 't', tenantRole: 'admin' },
      { DESIGN_UPLOAD_COPY: 'on' }
    )
    expect(got).toEqual({
      ok: true,
      on: true,
      manager: true,
      owner: false,
      uploads: [
        {
          id: 'a',
          name: 'Autumn',
          design: 'own',
          state: 'ready',
          failure: null,
          pictures: 2,
          missing: [{ host: 'x.example', count: 2, why: 'y' }],
          at: '2026-11-26T10:00:00Z'
        }
      ]
    })
    expect(
      (await readUploads({ tenantId: 't', tenantRole: 'staff' }, {})).on
    ).toBe(false)
  })
})
