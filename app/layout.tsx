import type { Metadata } from 'next'
import { Geist, Geist_Mono, Newsreader } from 'next/font/google'
import {
  brandCssVariables,
  defaultBrandPresentation
} from '@/lib/branding/presentation'
import './globals.css'

// Self-hosted at build time by next/font; the browser makes no font requests
// to Google. Variable names match the --gr-font-* tokens (docs/DESIGN.md).
const display = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  axes: ['opsz'],
  display: 'swap'
})
const ui = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
  display: 'swap'
})
const mono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap'
})

export const metadata: Metadata = {
  title: {
    default: defaultBrandPresentation.productName,
    template: `%s · ${defaultBrandPresentation.productName}`
  },
  description: defaultBrandPresentation.productDescription,
  robots: { index: false, follow: false }
}

/*
Design language: docs/DESIGN.md — calm, editorial, research-grade. Warm canvas,
near-black ink, one electric-blue accent, serif titles, mono labels, 4px shapes,
hairlines instead of shadows. Tokens: lib/design/tokens.ts.
*/
export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${ui.variable} ${mono.variable}`}
    >
      <body
        style={
          brandCssVariables(defaultBrandPresentation) as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  )
}
