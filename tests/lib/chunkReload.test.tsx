import { browser } from '../../src/lib/browser'
import { reloadOnChunkError } from '../../src/lib/chunkReload'

const failed = () => {
  const event = new Event('vite:preloadError', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

describe('reloadOnChunkError', () => {
  let clock = 1_000_000
  let stop: () => void
  beforeEach(() => {
    sessionStorage.clear()
    vi.spyOn(browser, 'reload').mockImplementation(() => {})
    stop = reloadOnChunkError(window, () => clock)
  })
  afterEach(() => { stop(); vi.restoreAllMocks() })

  it('a part of the app that fails to load (a page opened before an update) reloads the page once', () => {
    const event = failed()
    expect(browser.reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('a second failure within 30 s shows the error screen instead of reloading again', () => {
    failed()
    clock += 10_000
    const event = failed()
    expect(browser.reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })

  it('after 30 s a failure reloads again', () => {
    failed()
    clock += 31_000
    failed()
    expect(browser.reload).toHaveBeenCalledTimes(2)
  })

  it('without session storage it never reloads: nothing would stop a loop', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const event = failed()
    expect(browser.reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
