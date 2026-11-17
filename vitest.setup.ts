import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// next/font only works inside the Next compiler. The one local font is the
// GROS Urbanist (components/gros/font.ts); tests see its variable class.
vi.mock('next/font/local', () => ({
  default: () => ({ variable: 'urbanist-variable', className: 'urbanist' })
}))
