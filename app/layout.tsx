import type { Metadata } from 'next'
import { Archivo, Fragment_Mono } from 'next/font/google'
import {
  brandCssVariables,
  defaultBrandPresentation
} from '@/lib/branding/presentation'
import './globals.css'

const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  display: 'swap'
})

const fragmentMono = Fragment_Mono({
  variable: '--font-fragment-mono',
  subsets: ['latin'],
  weight: '400',
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
THESIS: Campaign work becomes evidence under review; refuse generic KPI-card dashboard composition.
OWN-WORLD: Warm proof surface, ink-dark rails, registration coral, editorial violet, attached annotations.
STORY: Operator sees what needs attention, opens one campaign proof, traces evidence, then acts.
FIRST VIEWPORT: Compact navigation, month strip, generous active proof table, fixed review rail; primary action attached to proof.
FORM: Proof Table, grounded direction 1, seed 0a100401.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
*/
export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${fragmentMono.variable}`}>
      <body
        data-design-seed="0a100401"
        style={
          brandCssVariables(defaultBrandPresentation) as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  )
}
