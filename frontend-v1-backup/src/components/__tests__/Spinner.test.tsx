import { render } from '@testing-library/react'
import { Spinner } from '../Spinner'

describe('Spinner', () => {
  it('renders an svg', () => {
    const { container } = render(<Spinner />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('has status role when label is provided', () => {
    render(<Spinner label="Loading" />)
    expect(document.querySelector('svg[role="status"]')).toBeInTheDocument()
  })

  it('is aria-hidden when no label', () => {
    render(<Spinner />)
    expect(document.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
  })
})
