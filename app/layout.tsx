import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import {
  brandCssVariables,
  defaultBrandPresentation
} from '@/lib/branding/presentation'
import './globals.css'

const inter = Inter({
  variable: '--font-inter',
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
THESIS: Campaign work becomes evidence under review; refuse generic KPI-card dashboard composition.
OWN-WORLD: Cool neutral workspace, white navigation and panels, near-black actions, blue interaction cues.
STORY: Operator sees what needs attention, opens one campaign proof, traces evidence, then acts.
FIRST VIEWPORT: Compact navigation, month strip, generous active proof table, fixed review rail; primary action attached to proof.
FORM: Quiet Operations, reference-neutral direction, seed 6f728f1c.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
*/
export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body
        data-design-seed="6f728f1c"
        style={
          brandCssVariables(defaultBrandPresentation) as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  )
}
