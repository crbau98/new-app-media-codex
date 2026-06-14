import { renderHook, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { useConnectivity } from '../useConnectivity'
import { useAppStore } from '../../store'

describe('useConnectivity', () => {
  beforeEach(() => {
    useAppStore.setState({ isOnline: true, apiUnreachable: false })
    ;(global.fetch as jest.Mock).mockReset()
  })

  it('returns online status from store', () => {
    const { result } = renderHook(() => useConnectivity())
    expect(result.current.isOnline).toBe(true)
  })

  it('sets offline when navigator.onLine is false and fetch fails', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      writable: true,
      value: false,
    })
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('network error'))
    renderHook(() => useConnectivity())
    await waitFor(() => {
      expect(useAppStore.getState().isOnline).toBe(false)
    })
  })

  it('marks api unreachable when fetch returns non-ok', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      writable: true,
      value: true,
    })
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 })
    renderHook(() => useConnectivity())
    await waitFor(() => {
      expect(useAppStore.getState().apiUnreachable).toBe(true)
    })
  })
})
