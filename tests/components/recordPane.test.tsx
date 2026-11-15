import { act, renderHook } from '@testing-library/react'
import { useRecordPane } from '../../src/pages/admin/useRecordPane'

describe('record pane', () => {
  afterEach(() => { window.history.replaceState(null, '', '/'); vi.restoreAllMocks() })
  it('starts at the list without a deep link and returns there after opening a record', () => {
    const { result } = renderHook(() => useRecordPane())
    expect(result.current.opened).toBe(false)
    act(() => result.current.open())
    expect(result.current.opened).toBe(true)
    act(() => result.current.back())
    expect(result.current.opened).toBe(false)
  })
  it('restores focus to a list item after leaving a deep-linked mobile record', () => {
    window.history.replaceState(null, '', '/accounts#account')
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('scrollTo', vi.fn())
    const item = document.createElement('button')
    item.className = 'side-list__item'
    document.body.append(item)
    try {
      const { result } = renderHook(() => useRecordPane())
      act(() => result.current.back())
      expect(item).toHaveFocus()
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 })
    } finally { item.remove(); vi.unstubAllGlobals() }
  })
  it('opens a linked record directly' , () => {
    window.history.replaceState(null, '', '/accounts#account')
    const { result } = renderHook(() => useRecordPane())
    expect(result.current.opened).toBe(true)
  })
})
