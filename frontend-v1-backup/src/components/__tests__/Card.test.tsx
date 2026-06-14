import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Card, CardHeader, CardBody } from '../Card'

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>)
    expect(screen.getByText(/card content/i)).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const handleClick = vi.fn()
    render(<Card onClick={handleClick}>Clickable</Card>)
    await userEvent.click(screen.getByRole('button', { name: /clickable/i }))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('renders as div when not clickable', () => {
    const { container } = render(<Card>Static</Card>)
    expect(container.querySelector('div')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<Card className="my-class">Styled</Card>)
    expect(container.firstChild).toHaveClass('my-class')
  })

  it('renders CardHeader and CardBody', () => {
    render(
      <Card>
        <CardHeader>Header</CardHeader>
        <CardBody>Body</CardBody>
      </Card>
    )
    expect(screen.getByText(/header/i)).toBeInTheDocument()
    expect(screen.getByText(/body/i)).toBeInTheDocument()
  })
})
