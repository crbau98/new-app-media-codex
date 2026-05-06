import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MediaHero } from '../MediaHero'
import type { Screenshot } from '@/lib/api'

const mockShot = (overrides?: Partial<Screenshot>): Screenshot =>
  ({
    id: 1,
    term: 'Test term',
    preview_url: 'https://example.com/preview.jpg',
    local_url: null,
    thumbnail_url: null,
    ai_summary: 'A test summary',
    ...overrides,
  } as Screenshot)

describe('MediaHero', () => {
  it('renders with image', () => {
    render(<MediaHero shots={[mockShot()]} onClick={vi.fn()} />)
    expect(screen.getByText(/test term/i)).toBeInTheDocument()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('renders nothing when no valid shots', () => {
    const { container } = render(<MediaHero shots={[]} onClick={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when all images fail', () => {
    const shot = mockShot({ preview_url: null, local_url: null, thumbnail_url: null })
    const { container } = render(<MediaHero shots={[shot]} onClick={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('calls onClick when watch/view button clicked', async () => {
    const handleClick = vi.fn()
    render(<MediaHero shots={[mockShot()]} onClick={handleClick} />)
    await userEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
