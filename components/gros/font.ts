import { Urbanist } from 'next/font/google'
import { cn } from '@/lib/utils'

/**
 * The GROS font (BRAND.md): Urbanist 400, 500 and 600. Loaded here, not in
 * the root layout, so only the pages built on the GROS shells download it.
 */
const urbanist = Urbanist({
  variable: '--font-urbanist',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap'
})

/**
 * The classes of a GROS screen's outermost element: the tokens (`.gros`)
 * and the font. Every GROS component sits inside one.
 */
export const grosRoot = (className?: string) =>
  cn('gros', urbanist.variable, className)
