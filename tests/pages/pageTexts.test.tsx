import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthGate } from '../../src/components/AuthGate'
import { applyFamilyLanguage } from '../../src/i18n/client'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { CashFlow } from '../../src/pages/CashFlow'
import { Goals } from '../../src/pages/Goals'
import { Login } from '../../src/pages/Login'
import { jsonResponse as json } from '../helpers/http'
import { ru, withLanguage } from '../helpers/i18n'
import { flowsSnapshot, makeGrowthBeyondSavings } from '../helpers/snapshot'
import { goalsSnapshot } from '../helpers/goals'
import { pageText, renderWithClient, renderExpandedSnapshot as renderPage, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

beforeEach(() => { stubSnapshotFetch(); resetAuth() })

describe('the login screen', () => {
  it('re-renders on a language switch: it sits above the remount', async () => {
    render(<Login />)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    await withLanguage('ru-RU', async () => {
      await waitFor(() => expect(screen.getByRole('button', { name: ru('auth.signIn') })).toBeInTheDocument())
      expect(screen.getByLabelText(ru('auth.password'))).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ru('app.title'))
    })
  })

  it('shows the sign-in screen through the gate and says when the server cannot be reached', async () => {
    setAuth({ mode: 'password', authenticated: false })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    renderWithClient(<AuthGate><span>app</span></AuthGate>)
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is unreachable')
    await act(() => applyFamilyLanguage('ru-RU'))
    try {
      expect(screen.getByRole('button', { name: ru('auth.signIn') })).toBeInTheDocument()
    } finally {
      await applyFamilyLanguage('en-US')
    }
  })

  it('says to wait on a 429 even when the body carries no code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 429)))
    render(<Login />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Wait a minute')
  })
})

describe('dashboard pages in Russian', () => {
  it('the cash-flow page speaks the language of the app and follows a switch', async () => {
    renderPage(<CashFlow />, flowsSnapshot())
    expect(screen.getByText('Where the money went')).toBeInTheDocument()
    await withLanguage('ru-RU', async () => {
      await waitFor(() => expect(screen.getByText(ru('cashflowPage.expenses.title'))).toBeInTheDocument())
      expect(screen.getByText(ru('cashflowPage.kpi.income'), { selector: '.cf-kpi__label' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: ru('cashflowPage.period.quarter') })).toBeInTheDocument()
      expect(screen.getByText(ru('cashflowPage.chart.strip'))).toBeInTheDocument()
    })
  })

  it('the growth-beyond-savings note takes the Russian plural form of the months it is out of', async () => {
    window.history.replaceState(null, '', '/goals?goal=fire')
    const totals = [1, 21, 22, 35]
    const g = makeGrowthBeyondSavings()
    await withLanguage('ru-RU', () => {
      for (const total of totals) {
        const used = Math.min(total, g.months.length)
        const { unmount } = renderPage(<Goals />, { ...goalsSnapshot(), growthBeyondSavings: { ...g, months: g.months.slice(0, used), monthsConsidered: total, minMonths: 1 } })
        expect(pageText(document.body)).toContain(ru('pages.goals.beyond.note', { used, count: total }))
        unmount()
      }
    })
    const forms = totals.map(count => ru('pages.goals.beyond.note', { used: 0, count }).replace(String(count), '#'))
    // "out of 1 / 21" takes the genitive singular, "out of 22 / 35" the genitive plural
    expect(forms[0]).toBe(forms[1])
    expect(forms[2]).toBe(forms[3])
    expect(forms[1]).not.toBe(forms[2])
  })

  it('Goals words the plan, the deadline and the forecast from the Russian locale', async () => {
    window.history.replaceState(null, '', '/goals?goal=fire')
    await withLanguage('ru-RU', () => {
      const { container } = renderPage(<Goals />, goalsSnapshot())
      const text = pageText(container)
      expect(text).toContain(ru('pages.goals.coast.title'))
      expect(text).toContain(ru('pages.goals.real.note', { rate: '8', inflation: '3,1', currency: 'USD' }))
      // Russian groups thousands with a space and puts the sign after the number; months are numeric
      expect(text).toContain(ru('goalsPage.progress', { current: '205 000 $', target: '2 000 000 $' }))
      expect(text).toContain(ru('goalsPage.status.fire', { month: '05.2046', span: `${ru('units.years', { count: 5, value: 5 })} ${ru('units.months', { count: 5, value: 5 })}` }))
    })
    window.history.replaceState(null, '', '/')
  })
})
