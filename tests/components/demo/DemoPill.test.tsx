import { createRef } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { TitleRow } from '../../../src/components/layout/TitleRow'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { emptySnapshot } from '../../helpers/snapshot'
import { renderWithSnapshot } from '../../helpers/render'
import { jsonResponse as json } from '../../helpers/http'
import { ru, withLanguage } from '../../helpers/i18n'

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0)
const INSTALL = 'https://example.org/family-finance'

const narrow = (matches: boolean) => vi.stubGlobal('matchMedia', (query: string) =>
  ({ matches: matches && query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} }))

function demo(left: number, installUrl: string | null = INSTALL) {
  setAuth({ mode: 'demo', authenticated: true, demo: { hint: 'demo-family', expiresAt: NOW + left, installUrl, expired: false, restarted: false } })
}

const renderRow = () => renderWithSnapshot(<TitleRow title="Overview" drawerOpen={false} onMenu={() => {}} menuButtonRef={createRef()} />, emptySnapshot())

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  narrow(false)
})
afterEach(() => { vi.useRealTimers(); resetAuth() })

describe('DemoPill', () => {
  it('says on a wide screen that this is a demo, whose changes they are and how long is left', () => {
    demo(754_000)
    renderRow()
    const pill = screen.getByText('Demo · only you see your changes · 12:34 left')
    expect(pill).toHaveClass('demo-pill')
    expect(pill).not.toHaveClass('demo-pill--warning')
    expect(screen.queryByRole('button', { name: /Demo/ })).toBeNull()
  })

  it('turns to the warning colour in the last two minutes', () => {
    demo(100_000)
    renderRow()
    expect(screen.getByText('Demo · only you see your changes · 1:40 left')).toHaveClass('demo-pill--warning')
  })

  it('reads naturally in Russian', async () => {
    demo(754_000)
    await withLanguage('ru-RU', () => {
      renderRow()
      expect(screen.getByText(ru('demo.pill.full', { time: '12:34' }))).toBeInTheDocument()
    })
  })

  it('is short up to 1000 px, where the title row has no room for the whole line beside the title', () => {
    vi.stubGlobal('matchMedia', (query: string) =>
      ({ matches: query === '(max-width: 1000px)', media: query, addEventListener() {}, removeEventListener() {} }))
    demo(754_000)
    renderRow()
    expect(screen.getByRole('button', { name: 'Demo · 12:34' })).toBeInTheDocument()
  })

  it('is short on a phone and opens the explanation with Start over and Install it yourself', async () => {
    narrow(true)
    demo(754_000)
    renderRow()
    expect(screen.queryByText(/only you see your changes · 12:34 left/)).toBeNull()
    const button = screen.getByRole('button', { name: 'Demo · 12:34' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('This is a demo: only you see your changes, and they will be deleted in 12:34.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Install it yourself' })).toHaveAttribute('href', INSTALL)

    const fetchMock = vi.fn(async () => json({ ok: true, expiresAt: NOW + 15 * 60_000 }))
    vi.stubGlobal('fetch', fetchMock)
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/demo/restart', expect.objectContaining({ method: 'POST' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Demo · 15:00' })).toHaveAttribute('aria-expanded', 'false'))
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull()
  })

  it('closes the panel on Escape and offers no install link without a URL', () => {
    narrow(true)
    demo(754_000, null)
    renderRow()
    const button = screen.getByRole('button', { name: 'Demo · 12:34' })
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Install it yourself' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull()
    expect(button).toHaveFocus()
  })

  it('shows nothing in the password mode', () => {
    setAuth({ mode: 'password', authenticated: true, demo: null })
    renderRow()
    expect(document.querySelector('.demo-pill')).toBeNull()
    expect(screen.queryByText(/Demo/)).toBeNull()
  })
})
