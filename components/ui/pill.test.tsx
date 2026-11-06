import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { campaignStatusOrder, campaignStatuses } from '@/lib/campaign-status'
import {
  DomainPill,
  Pill,
  pillTones,
  StatusPill,
  TypePill,
  domainLabel
} from './pill'

afterEach(cleanup)

describe('pills', () => {
  it('always shows a word, whatever the tone', () => {
    for (const tone of pillTones) {
      render(<Pill tone={tone}>{`tone ${tone}`}</Pill>)
      const pill = screen.getByText(`tone ${tone}`).parentElement!
      expect(pill).toHaveAttribute('data-tone', tone)
      expect(pill.className).toContain('uppercase')
    }
  })

  it('shows each campaign status with its word and meaning', () => {
    for (const status of campaignStatusOrder) {
      render(<StatusPill status={status} />)
      const pill = screen.getByText(
        campaignStatuses[status].label
      ).parentElement!
      expect(pill).toHaveAttribute('title', campaignStatuses[status].meaning)
      expect(pill).toHaveAttribute('data-tone', campaignStatuses[status].tone)
    }
  })

  it('marks TEXT emails with the accent-2 role and DESIGN with info', () => {
    render(
      <>
        <TypePill type="text" />
        <TypePill type="design" />
      </>
    )
    expect(screen.getByText('Text').parentElement).toHaveAttribute(
      'data-tone',
      'accent-2'
    )
    expect(screen.getByText('Design').parentElement).toHaveAttribute(
      'data-tone',
      'info'
    )
  })

  it('shows a clean domain and refuses anything else', () => {
    render(
      <>
        <DomainPill domain="https://www.Northwind.example/sale?x=1" />
        <DomainPill domain="owner@northwind.example" />
      </>
    )
    expect(screen.getByText('northwind.example')).toBeInTheDocument()
    expect(screen.getByText('Unknown domain')).toBeInTheDocument()
    expect(domainLabel('shop.northwind.co.uk')).toBe('shop.northwind.co.uk')
    expect(domainLabel('javascript:alert(1)')).toBeNull()
    expect(domainLabel('')).toBeNull()
    expect(domainLabel('localhost')).toBeNull()
    expect(domainLabel('a'.repeat(300) + '.com')).toBeNull()
  })

  it('reads real-world domains: long tracked links, ports and Unicode names', () => {
    const tracked = `https://www.northwind.example/sale?${'utm_source=klaviyo&'.repeat(15)}x=1`
    expect(tracked.length).toBeGreaterThan(253)
    expect(domainLabel(tracked)).toBe('northwind.example')
    expect(domainLabel('northwind.example:443')).toBe('northwind.example')
    expect(domainLabel('bücher.example')).toBe('xn--bcher-kva.example')
    expect(domainLabel('shop.xn--p1ai')).toBe('shop.xn--p1ai')
    expect(domainLabel('owner@northwind.example')).toBeNull()
    expect(domainLabel('two words.example')).toBeNull()
  })

  it('draws SENT with the brand pair the contrast gate checks', () => {
    render(<Pill tone="solid">Sent</Pill>)
    expect(screen.getByText('Sent').parentElement!.className).toContain(
      'bg-[var(--brand-primary)]'
    )
  })
})
