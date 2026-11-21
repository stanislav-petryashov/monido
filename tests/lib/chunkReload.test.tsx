import { browser } from '../../src/lib/browser'
import { reloadOnChunkError } from '../../src/lib/chunkReload'

const failed = () => {
  const event = new Event('vite:preloadError', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

describe('reloadOnChunkError', () => {
  let build = 'build-a'
  let stop: () => void
  beforeEach(() => {
    sessionStorage.clear()
    build = 'build-a'
    vi.spyOn(browser, 'reload').mockImplementation(() => {})
    stop = reloadOnChunkError(window, () => build)
  })
  afterEach(() => { stop(); vi.restoreAllMocks() })

  it('a part of the app that fails to load (a page opened before an update) reloads the page once', () => {
    const event = failed()
    expect(browser.reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('a second failure in the same build shows the error screen, however long each failure took', () => {
    failed()
    const event = failed()
    expect(browser.reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })

  it('after the reload brought a newer build, a failure in it reloads again', () => {
    failed()
    build = 'build-b'
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
