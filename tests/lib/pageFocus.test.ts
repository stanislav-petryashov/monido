import { act, renderHook } from '@testing-library/react'
import { consumePageFocus, requestPageFocus, useHashFocus } from '../../src/lib/pageFocus'

afterEach(() => { document.body.innerHTML = ''; window.history.replaceState(null, '', '/') })

describe('requestPageFocus', () => {
  it('focuses the page title', () => {
    document.body.innerHTML = '<h1 id="page-title" tabindex="-1">Modules</h1>'
    requestPageFocus()
    expect(document.getElementById('page-title')).toHaveFocus()
  })
  it('leaves focus alone when the address points at an element already on the page', () => {
    document.body.innerHTML = '<h1 id="page-title" tabindex="-1">Modules</h1><div id="loans" tabindex="-1"></div>'
    window.history.replaceState(null, '', '/settings/modules#loans')
    document.getElementById('loans')!.focus()
    requestPageFocus()
    expect(document.getElementById('loans')).toHaveFocus()
  })
  it('treats a malformed address hash as no target and focuses the title', () => {
    document.body.innerHTML = '<h1 id="page-title" tabindex="-1">Modules</h1>'
    window.history.replaceState(null, '', '/settings/modules#%')
    expect(() => requestPageFocus()).not.toThrow()
    expect(document.getElementById('page-title')).toHaveFocus()
  })
  it('a lazy page without its title yet: the title takes the focus when it mounts, once', () => {
    requestPageFocus()
    document.body.innerHTML = '<h1 id="page-title" tabindex="-1">Modules</h1><h1 id="later" tabindex="-1">Later</h1>'
    const title = document.getElementById('page-title')!
    consumePageFocus(title)
    expect(title).toHaveFocus()
    // the request is used up: a title mounted later does not take the focus again
    consumePageFocus(document.getElementById('later')!)
    expect(title).toHaveFocus()
  })
  it('a title that mounts with no request pending leaves the focus alone', () => {
    document.body.innerHTML = '<h1 id="page-title" tabindex="-1">Modules</h1>'
    consumePageFocus(document.getElementById('page-title')!)
    expect(document.body).toHaveFocus()
  })
})

describe('useHashFocus', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('once the page has its data, focuses the element the address names, in the next frame', () => {
    document.body.innerHTML = '<div id="liabilities" tabindex="-1"></div>'
    window.history.replaceState(null, '', '/net-worth#liabilities')
    const { result, rerender } = renderHook(({ ready }) => useHashFocus(ready), { initialProps: { ready: false } })
    expect(result.current).toBe('liabilities')
    // without the data it waits: the element may not be drawn yet
    act(() => vi.advanceTimersToNextFrame())
    expect(document.getElementById('liabilities')).not.toHaveFocus()
    rerender({ ready: true })
    expect(document.getElementById('liabilities')).not.toHaveFocus()
    act(() => vi.advanceTimersToNextFrame())
    expect(document.getElementById('liabilities')).toHaveFocus()
  })

  it('names no target without a hash, and focuses nothing', () => {
    document.body.innerHTML = '<div id="liabilities" tabindex="-1"></div>'
    const { result } = renderHook(() => useHashFocus(true))
    act(() => vi.advanceTimersToNextFrame())
    expect(result.current).toBe('')
    expect(document.body).toHaveFocus()
  })
})
