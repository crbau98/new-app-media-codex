import { renderHook } from '@testing-library/react'
import { useDebounce } from '../useDebounce'

describe('useDebounce', () => {
  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 500))
    expect(result.current).toBe('initial')
  })

  it('debounces value changes', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 50), {
      initialProps: { value: 'a' },
    })
    expect(result.current).toBe('a')
    rerender({ value: 'b' })
    expect(result.current).toBe('a')
    await new Promise((r) => setTimeout(r, 60))
    expect(result.current).toBe('b')
  })

  it('uses custom delay', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 20), {
      initialProps: { value: 'x' },
    })
    rerender({ value: 'y' })
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current).toBe('x')
    await new Promise((r) => setTimeout(r, 25))
    expect(result.current).toBe('y')
  })
})
