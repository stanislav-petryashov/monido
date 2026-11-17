import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { DemoDataDialogProps } from '../../../src/pages/admin/DemoDataDialog'
import type { DemoDataAvailability } from '../../../src/lib/demoData'
import { calls, renderWizard, stubSetupApi } from '../../helpers/setup'

const dialog = vi.hoisted(() => ({ props: [] as unknown[] }))
const demo = vi.hoisted(() => ({ afterDemoData: vi.fn(), availability: null as unknown }))

vi.mock('../../../src/pages/admin/DemoDataDialog', () => ({
  DemoDataDialog: (props: DemoDataDialogProps) => {
    if (!props.open) return null
    dialog.props.push(props)
    return (
      <div role="dialog" aria-label="mock dialog">
        <button type="button" onClick={() => props.onDone({} as never)}>mock load</button>
        <button type="button" onClick={props.onClose}>mock cancel</button>
      </div>
    )
  },
}))
vi.mock('../../../src/lib/demoData', async importOriginal => {
  const real = await importOriginal<typeof import('../../../src/lib/demoData')>()
  return {
    ...real,
    afterDemoData: demo.afterDemoData,
    useDemoDataAvailability: () => demo.availability ?? real.useDemoDataAvailability(),
  }
})

const liveLine = () => document.querySelector('p[aria-live="polite"]')
const heading = () => screen.getByRole('heading', {})
const available: DemoDataAvailability = { available: true, reason: null, needsPassword: false, endsTelegram: false, failed: false, retry: () => {} }

beforeEach(() => { sessionStorage.clear(); dialog.props = []; demo.afterDemoData.mockReset(); demo.availability = available })
afterEach(() => { sessionStorage.clear() })

describe('DataStep', () => {
  it('defaults to "My own data" and goes to Members without a write', async () => {
    const fetchMock = stubSetupApi()
    renderWizard({ step: 'data' })
    expect(await screen.findByRole('radio', { name: /My own data/ })).toBeChecked()
    expect(screen.getByText(/bring them in under Settings → Data → Import history/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(heading()).toHaveTextContent('Who owns the accounts'))
    expect(calls(fetchMock, 'PUT')).toEqual([])
    expect(calls(fetchMock, 'POST')).toEqual([])
  })

  it('reads "Keep my data" on an instance with data', async () => {
    stubSetupApi({ setup: { hasData: true } })
    renderWizard({ step: 'data' })
    expect(await screen.findByRole('radio', { name: /Keep my data/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Test data/ })).toHaveAccessibleName(/All the family's data entered so far is deleted\.$/)
  })

  it('treats a failed setup read as data being there', async () => {
    stubSetupApi({ answer: { 'GET /api/setup': () => new Response('{}', { status: 500 }) } })
    renderWizard({ step: 'data' })
    expect(await screen.findByRole('radio', { name: /Keep my data/ })).toBeInTheDocument()
  })

  it('"Test data" turns the primary into "Load test data" and keeps the count', async () => {
    stubSetupApi()
    renderWizard({ step: 'data' })
    fireEvent.click(await screen.findByRole('radio', { name: /Test data/ }))
    expect(screen.getByRole('button', { name: 'Load test data' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(liveLine()).toHaveTextContent('Step 2 of 4 · Data')
  })

  it.each([[false, 'plain'], [true, 'word']])('opens the demo dialog (hasData %s) with %s', async (hasData, confirmation) => {
    stubSetupApi({ setup: { hasData } })
    renderWizard({ step: 'data' })
    fireEvent.click(await screen.findByRole('radio', { name: /Test data/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Load test data' }))
    await screen.findByRole('dialog', { name: 'mock dialog' })
    // the family language reaches the dialog once the settings are read (without it the server keeps the stored one)
    await waitFor(() => expect(dialog.props.at(-1)).toMatchObject({ open: true, confirmation, language: 'en-US' }))
  })

  it('after the load calls afterDemoData and nothing else', async () => {
    const fetchMock = stubSetupApi()
    renderWizard({ step: 'data' })
    fireEvent.click(await screen.findByRole('radio', { name: /Test data/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Load test data' }))
    fireEvent.click(await screen.findByRole('button', { name: 'mock load' }))
    await waitFor(() => expect(demo.afterDemoData).toHaveBeenCalledTimes(1))
    expect(calls(fetchMock, 'PUT')).toEqual([])
    expect(calls(fetchMock, 'POST')).toEqual([])
  })

  it('a cancelled dialog stays on the data step with Test data selected', async () => {
    stubSetupApi()
    renderWizard({ step: 'data' })
    fireEvent.click(await screen.findByRole('radio', { name: /Test data/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Load test data' }))
    fireEvent.click(await screen.findByRole('button', { name: 'mock cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('radio', { name: /Test data/ })).toBeChecked()
    expect(demo.afterDemoData).not.toHaveBeenCalled()
  })

  it('draws the test card disabled while availability is still unknown', async () => {
    demo.availability = { ...available, available: false }
    stubSetupApi()
    renderWizard({ step: 'data' })
    expect(await screen.findByRole('radio', { name: /Test data/ })).toBeDisabled()
    expect(screen.queryByText(/not available on this server/)).toBeNull()
  })

  it('says why the test card is off when the sign-in settings could not be read, and Try again reads them again', async () => {
    const retry = vi.fn()
    demo.availability = { ...available, available: false, failed: true, retry }
    stubSetupApi()
    renderWizard({ step: 'data' })
    expect(await screen.findByRole('radio', { name: /Test data/ })).toBeDisabled()
    expect(screen.getByText('Could not check whether test data is available, so it is switched off for now.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('names the cards group by the step heading', async () => {
    stubSetupApi()
    renderWizard({ step: 'data' })
    expect(await screen.findByRole('group', { name: 'Where shall we start?' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('the demo dialog stands outside the step form: confirming it does not submit the step', async () => {
    stubSetupApi()
    renderWizard({ step: 'data' })
    fireEvent.click(await screen.findByRole('radio', { name: /Test data/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Load test data' }))
    const shown = await screen.findByRole('dialog', { name: 'mock dialog' })
    expect(shown.closest('form')).toBeNull()
    const opened = dialog.props.length
    fireEvent.click(screen.getByRole('button', { name: 'mock load' }))
    expect(demo.afterDemoData).toHaveBeenCalledTimes(1)
    // a submit of the step would ask again: the dialog would open with new props
    expect(dialog.props.length).toBe(opened)
    expect(heading()).toHaveTextContent('Where shall we start?')
  })
})
