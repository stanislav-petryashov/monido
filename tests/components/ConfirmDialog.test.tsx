import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NotifyProvider } from '../../src/components/NotifyProvider'
import { useConfirm, type ConfirmOptions } from '../../src/lib/notifyState'

const DELETE: ConfirmOptions = {
  title: 'Delete the account “Quillmark Bank · Robin”?',
  text: 'The whole month history will be deleted.',
  confirmLabel: 'Delete',
  tone: 'danger',
}
const REVERT: ConfirmOptions = {
  title: 'Revert change #12?',
  text: 'The row returns to its state before this edit.',
  confirmLabel: 'Revert',
  tone: 'warning',
}

function Ask({ options, onResult }: { options: ConfirmOptions; onResult: (yes: boolean) => void }) {
  const confirm = useConfirm()
  return <button onClick={async () => onResult(await confirm(options))}>Ask</button>
}

function open(options = DELETE) {
  const onResult = vi.fn()
  const view = render(
    <NotifyProvider>
      <h1 id="page-title" tabIndex={-1}>Accounts</h1>
      <Ask options={options} onResult={onResult} />
    </NotifyProvider>
  )
  const trigger = screen.getByRole('button', { name: 'Ask' })
  act(() => trigger.focus())
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: options.title })
  return { onResult, trigger, dialog, view }
}

describe('ConfirmDialog', () => {
  it('asks the question with its explanation and starts on Cancel', () => {
    const { dialog } = open()
    expect(dialog).toHaveAccessibleDescription('The whole month history will be deleted.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('a deletion gets a trash icon on red and a solid red button', () => {
    const { dialog } = open()
    expect(dialog.querySelector('.avatar')).toHaveAttribute('data-color', 'error')
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn--danger-solid')
  })

  it('puts Cancel before the confirming action', () => {
    const { dialog } = open()
    const names = within(dialog).getAllByRole('button').map(b => b.textContent)
    expect(names).toEqual(['Cancel', 'Delete'])
  })

  it('a revert gets an orange icon and the primary button', () => {
    const { dialog } = open(REVERT)
    expect(dialog.querySelector('.avatar')).toHaveAttribute('data-color', 'warning')
    expect(screen.getByRole('button', { name: 'Revert' })).toHaveClass('btn--primary')
  })

  it.each([
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['a click on the backdrop', (d: HTMLElement) => { fireEvent.mouseDown(d); fireEvent.click(d) }],
    ['Escape (the browser closes the dialog)', (d: HTMLElement) => act(() => (d as HTMLDialogElement).close())],
  ])('%s answers no and gives the focus back', async (_, dismiss) => {
    const { onResult, trigger, dialog } = open()
    dismiss(dialog)
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('a text selection dragged from inside the window out to the backdrop does not answer the question', () => {
    const { onResult, dialog } = open()
    fireEvent.mouseDown(dialog.querySelector('button')!)
    fireEvent.click(dialog)
    expect(onResult).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('the second click of a double click does not answer the question', () => {
    const { onResult, dialog } = open()
    fireEvent.click(dialog, { detail: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }), { detail: 2 })
    expect(dialog).toHaveAttribute('open')
    expect(onResult).not.toHaveBeenCalled()
  })

  it('confirming a deletion answers yes and moves the focus to the page title — the row is about to go', async () => {
    const { onResult } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
    expect(screen.getByRole('heading', { name: 'Accounts' })).toHaveFocus()
  })

  it('confirming a revert also moves the focus to the page title — the reverted row loses its button', async () => {
    const { onResult } = open(REVERT)
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
    expect(screen.getByRole('heading', { name: 'Accounts' })).toHaveFocus()
  })

  it('moving the focus to the page title does not scroll the page to the top', async () => {
    const { onResult } = open()
    const focus = vi.spyOn(screen.getByRole('heading', { name: 'Accounts' }), 'focus')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('falls back to the page title when the button that asked is gone', async () => {
    function Vanishing() {
      const confirm = useConfirm()
      const [shown, setShown] = useState(true)
      return shown ? <button onClick={() => { void confirm(DELETE); setShown(false) }}>Ask</button> : null
    }
    render(<NotifyProvider><h1 id="page-title" tabIndex={-1}>Accounts</h1><Vanishing /></NotifyProvider>)
    const trigger = screen.getByRole('button', { name: 'Ask' })
    act(() => trigger.focus())
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Accounts' })).toHaveFocus())
  })

  it('a second question while one is open answers the first with no', async () => {
    const first = vi.fn()
    function Twice() {
      const confirm = useConfirm()
      return <button onClick={() => { void confirm(DELETE).then(first); void confirm(REVERT) }}>Twice</button>
    }
    render(<NotifyProvider><Twice /></NotifyProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Twice' }))
    await waitFor(() => expect(first).toHaveBeenCalledWith(false))
    expect(screen.getByRole('dialog', { name: REVERT.title })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: DELETE.title })).toBeNull()
  })

  it('answers no when the app goes away with the question open', async () => {
    const { onResult, view } = open()
    view.unmount()
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })

  it('useConfirm outside the provider fails loudly', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Ask options={DELETE} onResult={() => {}} />)).toThrow(/NotifyProvider/)
  })
})
