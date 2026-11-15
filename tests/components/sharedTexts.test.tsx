import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotifyProvider } from '../../src/components/NotifyProvider'
import { PageError } from '../../src/components/PageError'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'
import { ZoneBar } from '../../src/components/cards/ZoneBar'
import { Loading } from '../../src/components/ui/Loading'
import { useConfirm, useToast } from '../../src/lib/notifyState'
import { ru, withLanguage } from '../helpers/i18n'

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) })

describe('shared components in Russian', () => {
  it('the zone bar names its zone and thresholds in the locale', async () => {
    await withLanguage('ru-RU', () => {
      render(<ZoneBar zone="amber" thresholds={[5, 15, 25]} inverse={false} unit="%" />)
      expect(screen.getByRole('img')).toHaveAccessibleName(ru('cards.zone.known', { zone: ru('zones.amber'), thresholds: '≤ 5%, 5–15, 15–25, > 25%' }))
    })
  })

  it('a missing zone is named as such', () => {
    render(<ZoneBar zone={null} thresholds={[5, 15, 25]} inverse={false} unit="%" />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Zone not determined. Thresholds: ≤ 5%, 5–15, 15–25, > 25%')
  })
})

describe('components above the language-keyed remount follow a switch', () => {
  it('PageError falls back to the load-error text in the current language', async () => {
    render(<PageError />)
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load')
    await withLanguage('ru-RU', async () => {
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ru('common.loadError')))
    })
  })

  it('a message given to PageError is shown as is', () => {
    render(<PageError>Custom</PageError>)
    expect(screen.getByRole('alert')).toHaveTextContent('Custom')
  })

  it('the toast close button and the dialog cancel button are re-labelled', async () => {
    function Controls() {
      const toast = useToast()
      const confirm = useConfirm()
      return (
        <>
          <button onClick={() => toast.error('Failed')}>toast</button>
          <button onClick={() => { void confirm({ title: 'Sure?', confirmLabel: 'Yes', tone: 'danger' }) }}>ask</button>
        </>
      )
    }
    render(<NotifyProvider><Controls /></NotifyProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'toast' }))
    fireEvent.click(screen.getByRole('button', { name: 'ask' }))
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    await withLanguage('ru-RU', async () => {
      await waitFor(() => expect(screen.getByRole('button', { name: ru('common.dismissNotification') })).toBeInTheDocument())
      expect(screen.getByRole('button', { name: ru('common.cancel') })).toBeInTheDocument()
    })
    // leave no open dialog behind for the next test
    act(() => (screen.getByRole('dialog') as HTMLDialogElement).close())
  })

  it('Loading follows the language', async () => {
    render(<Loading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    await withLanguage('ru-RU', async () => {
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(ru('common.loading')))
    })
  })
})

describe('ErrorBoundary', () => {
  it('names the failure in the current language', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Boom(): never { throw new Error('kaboom') }
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByText('Could not display the page')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not display the page')
    expect(screen.getByText(/kaboom/).closest('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeEnabled()
  })
})
