import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown, parseBlocks } from './markdown'

afterEach(cleanup)

describe('Markdown', () => {
  it('renders paragraphs, line breaks, lists and bold', () => {
    const { container } = render(
      <Markdown
        text={
          'Here is your workspace today.\n\n- **Last sent:** "Spring" on Nov 3.\n- **Next planned send:** nothing.\n\nNext step: plan.\nThen relax.\n\n1. First\n2. Second'
        }
      />
    )
    expect(container.querySelectorAll('p')).toHaveLength(2)
    expect(container.querySelectorAll('ul > li')).toHaveLength(2)
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
    expect(screen.getByText('Last sent:').tagName).toBe('STRONG')
    expect(container.querySelectorAll('br')).toHaveLength(1)
  })

  it('never turns text into markup or links', () => {
    const { container } = render(
      <Markdown
        text={
          '<img src=x onerror=alert(1)> [click](https://evil.example) **bold'
        }
      />
    )
    expect(container.querySelector('img, a, script')).toBeNull()
    expect(container.textContent).toBe(
      '<img src=x onerror=alert(1)> [click](https://evil.example) **bold'
    )
  })

  it('drops empty paragraphs and keeps Windows line endings tidy', () => {
    expect(parseBlocks('\r\n\r\nOne\r\n\r\n\r\nTwo\r\n')).toEqual([
      { kind: 'p', lines: ['One'] },
      { kind: 'p', lines: ['Two'] }
    ])
  })
})
