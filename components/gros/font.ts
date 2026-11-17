import localFont from 'next/font/local'
import { cn } from '@/lib/utils'

/**
 * The GROS font (BRAND.md): Urbanist, used at 400, 500 and 600. The Latin
 * file of the variable font (SIL Open Font License, `fonts/OFL.txt`) ships
 * with the app, so a build never depends on what Google Fonts answers that
 * minute (a CI build failed on a font link it could not read). Loaded here,
 * not in the root layout, so only the pages built on the GROS shells
 * download it.
 */
const urbanist = localFont({
  src: './fonts/urbanist-latin.woff2',
  variable: '--font-urbanist',
  weight: '100 900',
  style: 'normal',
  display: 'swap'
})

/**
 * The classes of a GROS screen's outermost element: the tokens (`.gros`)
 * and the font. Every GROS component sits inside one.
 */
export const grosRoot = (className?: string) =>
  cn('gros', urbanist.variable, className)
