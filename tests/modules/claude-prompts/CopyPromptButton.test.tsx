import { i18n } from '../../../src/i18n/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { CopyPromptButton } from '../../../src/modules/claude-prompts/CopyPromptButton'
import { PromptPreviewDialog } from '../../../src/modules/claude-prompts/PromptPreviewDialog'
import { PrivacyContext } from '../../../src/lib/privacy'
import { DashboardContext } from '../../../src/lib/dashboardState'
import { buildMetricPrompt } from '../../../src/modules/claude-prompts/prompts'
import type { FinanceSnapshot } from '../../../src/domain/types'
import { makeSnapshot } from '../../helpers/snapshot'
import { renderWithClient, snapshotClient } from '../../helpers/render'

const TRIGGER = 'Show the question for Claude: Emergency fund'

/** The button under a stubbed dashboard context (not DashboardProvider): this sets how amounts are formatted. */
function renderButton(snapshot?: FinanceSnapshot, dashboard?: { fmt: (v: number) => string }) {
  const button = <CopyPromptButton metric="emergency_months" />
  renderWithClient(
    dashboard
      ? <DashboardContext.Provider value={{ ...defaultDashboard(), ...dashboard, fmtPlain: dashboard.fmt }}>{button}</DashboardContext.Provider>
      : button,
    { client: snapshotClient(snapshot) },
  )
  return screen.queryByRole('button', { name: TRIGGER }) as HTMLElement
}

function defaultDashboard() {
  return {
    view: null, period: '1y' as const,
    rates: undefined, ratesLoading: false, fmt: (v: number) => `$${v}`, fmtPlain: (v: number) => `$${v}`, fmtCompact: (v: number) => `$${v}`,
    setPeriod: () => {},
  }
}

function openPreview(trigger: HTMLElement) {
  fireEvent.click(trigger)
  return screen.getByRole('dialog', { name: 'Question for Claude: Emergency fund' })
}

beforeEach(() => {
  // the snapshot comes from the cache; the network request must not finish
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => {
  delete (document as { execCommand?: unknown }).execCommand
})

describe('CopyPromptButton', () => {
  it('is disabled until the snapshot is loaded', () => {
    expect(renderButton()).toBeDisabled()
  })

  it('opens a preview instead of copying straight away', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const trigger = renderButton(makeSnapshot())
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    const dialog = openPreview(trigger)
    expect(writeText).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toHaveFocus()
  })

  it('highlights the metric and the question, the parts that matter most', () => {
    const dialog = openPreview(renderButton(makeSnapshot()))
    const block = (text: string) => within(dialog).getByRole('heading', { name: text }).closest('section')
    expect(block('Metric: Emergency fund')).toHaveClass('prompt-block--accent')
    expect(block('Question')).toHaveClass('prompt-block--accent')
    expect(block('Data warnings')).not.toHaveClass('prompt-block--accent')
  })

  it('copies exactly the text it shows and stays open with a confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const dialog = openPreview(renderButton(makeSnapshot(), { fmt: v => `$${v}` }))
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' })) })
    expect(writeText).toHaveBeenCalledWith(buildMetricPrompt(makeSnapshot(), 'emergency_months', {
      money: v => `$${v}`, currencyName: 'US Dollar (USD)', converted: true,
    }))
    expect(within(dialog).getByRole('status')).toHaveTextContent('Copied. Paste it into Claude')
    expect(dialog).toHaveAttribute('open')
  })

  it('tells how to copy by hand when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn(() => false)
    const dialog = openPreview(renderButton(makeSnapshot()))
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' })) })
    expect(within(dialog).getByRole('status')).toHaveTextContent('Could not copy. Select the text and copy it by hand')
  })

  it.each([
    ['the close button', (d: HTMLElement) => fireEvent.click(within(d).getByRole('button', { name: 'Close' }))],
    ['the cross', (d: HTMLElement) => fireEvent.click(within(d).getByRole('button', { name: 'Close the window' }))],
    ['Escape (the browser closes the dialog)', (d: HTMLElement) => act(() => (d as HTMLDialogElement).close())],
  ])('closing with %s gives focus back to the trigger', (_, close) => {
    const trigger = renderButton(makeSnapshot())
    close(openPreview(trigger))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('names the currency without a note when every amount is already in it', () => {
    const snap = makeSnapshot()
    const cap = snap.capital!
    const usdOnly = makeSnapshot({
      capital: { ...cap, accounts: cap.accounts.map(a => ({ ...a, currency: 'USD' })), realEstate: [], loans: [] },
      cashflow: { ...snap.cashflow, rows: snap.cashflow.rows.map(r => ({ ...r, currency: 'USD' })) },
    })
    const dialog = openPreview(renderButton(usdOnly, { fmt: v => `$${v}` }))
    expect(dialog).toHaveTextContent('Currency of amounts: US Dollar (USD).')
    expect(dialog).not.toHaveTextContent('converted at the rate')
  })

  it('names the snapshot\'s currency', () => {
    const rub = makeSnapshot({ baseCurrency: 'RUB', rates: { date: '2031-05-15', perUsd: 83 } })
    const dialog = openPreview(renderButton(rub, { fmt: v => `${v} ₽` }))
    expect(dialog).toHaveTextContent('Currency of amounts: Russian Ruble (RUB); each amount is converted at the rate of its own date')
  })

  it('names a currency without a locale name by its code', () => {
    const dialog = openPreview(renderButton(makeSnapshot({ baseCurrency: 'ZZZ' }), { fmt: v => `${v}` }))
    expect(dialog).toHaveTextContent('Currency of amounts: ZZZ;')
    expect(dialog).not.toHaveTextContent('(ZZZ)')
  })
})

describe('PromptPreviewDialog', () => {
  it('says the question could not be built instead of offering an empty copy', () => {
    render(<PromptPreviewDialog title="Emergency fund" blocks={null} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Question for Claude: Emergency fund' })
    expect(dialog).toHaveTextContent('Could not build the question')
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeDisabled()
  })
})

describe('Ask Claude in privacy mode', () => {
  function setup(hidden: boolean) {
    const client = snapshotClient(makeSnapshot())
    const tree = (isHidden: boolean, amount = '$912345.67') => <PrivacyContext.Provider value={{ hidden: isHidden, toggle: () => {} }}>
      <DashboardContext.Provider value={{ ...defaultDashboard(), fmtPlain: () => amount }}>
        <CopyPromptButton metric="emergency_months" />
      </DashboardContext.Provider>
    </PrivacyContext.Provider>
    const view = renderWithClient(tree(hidden), { client })
    return { ...view, privacy: (value: boolean, amount?: string) => view.rerender(<QueryClientProvider client={client}>{tree(value, amount)}</QueryClientProvider>) }
  }

  function gated(dialog: HTMLElement) {
    expect(dialog.outerHTML).not.toContain('912345.67')
    expect(within(dialog).queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Show amounts' })).toHaveFocus()
  }

  it('requires reveal and resets consent on close and reopen', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    setup(true)
    const trigger = screen.getByRole('button', { name: TRIGGER })
    let dialog = openPreview(trigger)
    gated(dialog)
    expect(writeText).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show amounts' }))
    expect(dialog).toHaveTextContent('912345.67')
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toHaveFocus()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' })) })
    expect(writeText.mock.calls[0][0]).toContain('912345.67')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(trigger).toHaveFocus()
    dialog = openPreview(trigger)
    gated(dialog)
  })

  it('gates visible previews on every transition to hidden', () => {
    const view = setup(false)
    const dialog = openPreview(screen.getByRole('button', { name: TRIGGER }))
    expect(dialog).toHaveTextContent('912345.67')
    view.privacy(true)
    gated(dialog)
    view.privacy(false)
    expect(dialog).toHaveTextContent('912345.67')
    view.privacy(true)
    gated(dialog)
  })

  it('freezes the revealed prompt across data and language changes', async () => {
    const view = setup(true)
    const dialog = openPreview(screen.getByRole('button', { name: TRIGGER }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show amounts' }))
    const body = dialog.querySelector('.prompt-dialog__body')!.textContent
    view.privacy(true, '$111111.11')
    await act(async () => { await i18n.changeLanguage('ru-RU') })
    expect(dialog.querySelector('.prompt-dialog__body')!.textContent).toBe(body)
    expect(dialog).not.toHaveTextContent('111111.11')
    await act(async () => { await i18n.changeLanguage('en-US') })
  })

  it('discards a pending copy after close and reopen', async () => {
    let reject!: (error: Error) => void
    vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>((_, fail) => { reject = fail }) } })
    document.execCommand = vi.fn(() => true)
    const append = vi.spyOn(document.body, 'appendChild')
    setup(true)
    const trigger = screen.getByRole('button', { name: TRIGGER })
    let dialog = openPreview(trigger)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show amounts' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    dialog = openPreview(trigger)
    const focus = document.activeElement
    append.mockClear()
    await act(async () => { reject(new Error('denied')); await Promise.resolve() })
    expect(document.execCommand).not.toHaveBeenCalled()
    expect(append.mock.calls.some(([node]) => node instanceof HTMLTextAreaElement)).toBe(false)
    expect(document.activeElement).toBe(focus)
    expect(within(dialog).getByRole('status')).toBeEmptyDOMElement()
    append.mockRestore()
  })

  it('cancels fallback as soon as the native dialog closes, before its close event', async () => {
    let reject!: (error: Error) => void
    vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>((_, fail) => { reject = fail }) } })
    document.execCommand = vi.fn(() => true)
    const append = vi.spyOn(document.body, 'appendChild')
    setup(false)
    const dialog = openPreview(screen.getByRole('button', { name: TRIGGER }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
    dialog.removeAttribute('open')
    append.mockClear()
    await act(async () => { reject(new Error('denied')); await Promise.resolve() })
    expect(document.execCommand).not.toHaveBeenCalled()
    expect(append.mock.calls.some(([node]) => node instanceof HTMLTextAreaElement)).toBe(false)
    fireEvent(dialog, new Event('close'))
    append.mockRestore()
  })

  it.each(['reject', 'resolve'])('does not let an old copy %s revive a gated session', async outcome => {
    let settle!: () => void
    const writeText = vi.fn(() => new Promise<void>((resolve, reject) => { settle = outcome === 'resolve' ? resolve : () => reject(new Error('denied')) }))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const exec = vi.fn(() => true)
    document.execCommand = exec
    const append = vi.spyOn(document.body, 'appendChild')
    const view = setup(false)
    const dialog = openPreview(screen.getByRole('button', { name: TRIGGER }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
    view.privacy(true)
    const focus = document.activeElement
    append.mockClear()
    await act(async () => { settle(); await Promise.resolve() })
    expect(exec).not.toHaveBeenCalled()
    expect(append.mock.calls.some(([node]) => node instanceof HTMLTextAreaElement)).toBe(false)
    expect(document.activeElement).toBe(focus)
    expect(within(dialog).getByRole('status')).toBeEmptyDOMElement()
    append.mockRestore()
  })
})
