import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { NotifyProvider } from '../../src/components/NotifyProvider'
import { SUCCESS_MS } from '../../src/components/ui/Toaster'
import { useToast } from '../../src/lib/notifyState'

let moduleCount = 0

function Buttons() {
  const toast = useToast()
  return (
    <>
      <button onClick={() => toast.success('Account added', 'Quillmark Bank · Robin')}>ok</button>
      <button onClick={() => toast.error('Could not save', new Error('boom'))}>fail</button>
      <button onClick={() => toast.success('Module enabled', undefined, [{ label: 'Goals', to: '/goals' }, { label: 'Overview', to: '/' }])}>links</button>
      <button onClick={() => toast.success(`Module ${++moduleCount} enabled`, undefined, [{ label: 'Goals', to: '/goals' }])}>numbered</button>
    </>
  )
}

/** The visible success card (the screen-reader live region is a separate element) */
const successCard = () => document.querySelector('.toast:not([role="alert"])') as HTMLElement | null

function renderToasts() {
  render(<NotifyProvider><Buttons /></NotifyProvider>)
  return { ok: screen.getByRole('button', { name: 'ok' }), fail: screen.getByRole('button', { name: 'fail' }), links: screen.getByRole('button', { name: 'links' }) }
}

beforeEach(() => { moduleCount = 0 })
afterEach(() => vi.useRealTimers())

describe('NotifyProvider toasts', () => {
  it('announces a success through a live region that was in the DOM before the toast', () => {
    const { ok } = renderToasts()
    const live = screen.getByRole('status')
    expect(live).toBeEmptyDOMElement()
    fireEvent.click(ok)
    expect(live).toHaveTextContent('Account added. Quillmark Bank · Robin')
    expect(successCard()).not.toHaveAttribute('role')
  })

  it('announces a success politely and hides it after four seconds', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { ok } = renderToasts()
    fireEvent.click(ok)
    expect(successCard()).toHaveTextContent('Account added')
    expect(successCard()).toHaveTextContent('Quillmark Bank · Robin')
    act(() => { vi.advanceTimersByTime(SUCCESS_MS - 1) })
    expect(successCard()).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(successCard()).toBeNull()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('waits while the pointer is over a success toast', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { ok } = renderToasts()
    fireEvent.click(ok)
    fireEvent.mouseEnter(successCard()!)
    act(() => { vi.advanceTimersByTime(SUCCESS_MS * 3) })
    expect(successCard()).toBeInTheDocument()
    fireEvent.mouseLeave(successCard()!)
    act(() => { vi.advanceTimersByTime(SUCCESS_MS) })
    expect(successCard()).toBeNull()
  })

  it('waits while the keyboard focus is inside a success toast', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { ok } = renderToasts()
    fireEvent.click(ok)
    act(() => within(successCard()!).getByRole('button', { name: 'Dismiss notification' }).focus())
    act(() => { vi.advanceTimersByTime(SUCCESS_MS * 3) })
    expect(successCard()).toBeInTheDocument()
  })

  it('shows the links of a success and closes the toast when one is followed', () => {
    window.history.replaceState(null, '', '/settings/modules')
    const { links } = renderToasts()
    fireEvent.click(links)
    const card = successCard()!
    expect(within(card).getByRole('link', { name: 'Goals' })).toHaveAttribute('href', '/goals')
    expect(within(card).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/')
    // the live region reads the links too
    expect(screen.getByRole('status')).toHaveTextContent('Module enabled. Goals, Overview')
    fireEvent.click(within(card).getByRole('link', { name: 'Goals' }))
    expect(window.location.pathname).toBe('/goals')
    expect(successCard()).toBeNull()
  })

  it('keeps a toast with links until it is dismissed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { links } = renderToasts()
    fireEvent.click(links)
    act(() => { vi.advanceTimersByTime(SUCCESS_MS * 15) })
    expect(successCard()).toBeInTheDocument()
    fireEvent.click(within(successCard()!).getByRole('button', { name: 'Dismiss notification' }))
    expect(successCard()).toBeNull()
  })

  it('still hides a plain toast on time while a link toast stays', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { ok, links } = renderToasts()
    fireEvent.click(links)
    fireEvent.click(ok)
    act(() => { vi.advanceTimersByTime(SUCCESS_MS) })
    expect(document.querySelectorAll('.toast')).toHaveLength(1)
    expect(successCard()).toHaveTextContent('Module enabled')
  })

  it('does not announce an older link toast again when a later plain toast expires', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { ok, links } = renderToasts()
    const live = screen.getByRole('status')
    fireEvent.click(links)
    expect(live).toHaveTextContent('Module enabled. Goals, Overview')
    fireEvent.click(ok)
    expect(live).toHaveTextContent('Account added')
    act(() => { vi.advanceTimersByTime(SUCCESS_MS) })
    expect(document.querySelectorAll('.toast')).toHaveLength(1)
    expect(live).toBeEmptyDOMElement()
  })

  it('puts the toasts in a labelled region that a keyboard can reach', () => {
    const { links } = renderToasts()
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(region).toContainElement(screen.getByRole('status'))
    fireEvent.click(links)
    const card = successCard()!
    expect(region).toContainElement(card)
    for (const el of [...within(card).getAllByRole('link'), within(card).getByRole('button', { name: 'Dismiss notification' })]) {
      expect(el).not.toHaveAttribute('tabindex', '-1')
    }
  })

  it('shows at most three link toasts, dropping the oldest', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderToasts()
    const numbered = screen.getByRole('button', { name: 'numbered' })
    for (let i = 0; i < 4; i++) fireEvent.click(numbered)
    act(() => { vi.advanceTimersByTime(SUCCESS_MS * 15) })
    const titles = [...document.querySelectorAll('.toast__title')].map(el => el.textContent)
    expect(titles).toEqual(['Module 2 enabled', 'Module 3 enabled', 'Module 4 enabled'])
  })

  it('does not take the focus away', () => {
    const { ok } = renderToasts()
    act(() => ok.focus())
    fireEvent.click(ok)
    expect(ok).toHaveFocus()
  })

  it('keeps an error with the clean server text until it is closed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { fail } = renderToasts()
    fireEvent.click(fail)
    act(() => { vi.advanceTimersByTime(60_000) })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not save')
    expect(alert).toHaveTextContent('boom')
    expect(alert).not.toHaveTextContent('Error:')
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows at most three toasts, dropping the oldest', () => {
    const { ok, fail } = renderToasts()
    fireEvent.click(ok)
    fireEvent.click(fail)
    fireEvent.click(fail)
    fireEvent.click(fail)
    expect(successCard()).toBeNull()
    expect(screen.getAllByRole('alert')).toHaveLength(3)
  })

  it('useToast outside the provider fails loudly', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Buttons />)).toThrow(/NotifyProvider/)
  })
})
