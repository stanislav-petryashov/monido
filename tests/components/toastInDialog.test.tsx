import { useRef, useState, type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { NotifyProvider } from '../../src/components/NotifyProvider'
import { Dialog } from '../../src/components/ui/Dialog'
import { SUCCESS_MS } from '../../src/components/ui/Toaster'
import { useModalDialog } from '../../src/components/ui/useModalDialog'
import { useToast } from '../../src/lib/notifyState'

// A modal <dialog> makes the rest of the page inert (jsdom has neither the top layer nor inert): a toast pushed while
// one is open has to live inside the topmost open dialog to be clickable and announced, and go back when it closes.

function Window({ name, onClose, children }: { name: string; onClose: () => void; children?: ReactNode }) {
  const focus = useRef<HTMLButtonElement>(null)
  const { dialogRef, close } = useModalDialog(focus)
  const toast = useToast()
  return (
    <Dialog dialogRef={dialogRef} className="form-dialog" aria-labelledby={`${name}-title`} onClose={onClose} onDismiss={() => close('cancel')}>
      <h2 id={`${name}-title`}>{name}</h2>
      <button ref={focus} onClick={() => toast.error(`${name} failed`)}>{`fail in ${name}`}</button>
      <button onClick={() => close('cancel')}>{`close ${name}`}</button>
      {children}
    </Dialog>
  )
}

function Page() {
  const [outer, setOuter] = useState(false)
  const [inner, setInner] = useState(false)
  return (
    <>
      <button onClick={() => setOuter(true)}>open</button>
      {outer && (
        <Window name="outer" onClose={() => setOuter(false)}>
          <button onClick={() => setInner(true)}>open inner</button>
        </Window>
      )}
      {/* a sibling, as ConfirmDialog is to a FormDialog: React's onClose would bubble to a parent window */}
      {inner && <Window name="inner" onClose={() => setInner(false)} />}
    </>
  )
}

function Ok() {
  const toast = useToast()
  return <button onClick={() => toast.success('Saved')}>ok</button>
}

const region = () => screen.getByRole('region', { name: 'Notifications' })
const dialogOf = (name: string) => screen.getByRole('heading', { name }).closest('dialog')!

describe('toasts while a modal dialog is open', () => {
  it('renders the notifications inside the open dialog and moves them back to the page when it closes', () => {
    render(<NotifyProvider><Page /></NotifyProvider>)
    expect(region().closest('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    fireEvent.click(screen.getByRole('button', { name: 'fail in outer' }))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('outer failed')
    expect(dialogOf('outer')).toContainElement(alert)
    expect(document.querySelectorAll('.toaster')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'close outer' }))
    expect(document.querySelector('dialog')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('outer failed')
    expect(region().closest('dialog')).toBeNull()
    expect(document.body).toContainElement(region())
  })

  it('follows the topmost open dialog', () => {
    render(<NotifyProvider><Page /></NotifyProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    fireEvent.click(screen.getByRole('button', { name: 'open inner' }))
    fireEvent.click(screen.getByRole('button', { name: 'fail in inner' }))
    expect(dialogOf('inner')).toContainElement(region())

    fireEvent.click(screen.getByRole('button', { name: 'close inner' }))
    expect(region().closest('dialog')).toBe(dialogOf('outer'))
    expect(screen.getByRole('alert')).toHaveTextContent('inner failed')
  })

  it('keeps one live region, with its text, when the stack moves', () => {
    render(<NotifyProvider><Ok /><Page /></NotifyProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'ok' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(dialogOf('outer')).toContainElement(screen.getByRole('status'))
  })

  it('moves the same live region and toast nodes in and out of the dialog', () => {
    render(<NotifyProvider><Ok /><Page /></NotifyProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'ok' }))
    const live = screen.getByRole('status')
    const card = document.querySelector('.toast')!
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(dialogOf('outer')).toContainElement(live)
    expect(screen.getByRole('status')).toBe(live)
    expect(document.querySelector('.toast')).toBe(card)

    fireEvent.click(screen.getByRole('button', { name: 'close outer' }))
    expect(document.querySelector('dialog')).toBeNull()
    expect(screen.getByRole('status')).toBe(live)
    expect(document.querySelector('.toast')).toBe(card)
    expect(document.body).toContainElement(card as HTMLElement)
  })

  it('does not restart a success timer when the stack moves', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      render(<NotifyProvider><Ok /><Page /></NotifyProvider>)
      fireEvent.click(screen.getByRole('button', { name: 'ok' }))
      act(() => { vi.advanceTimersByTime(SUCCESS_MS - 1000) })
      fireEvent.click(screen.getByRole('button', { name: 'open' }))
      expect(dialogOf('outer')).toContainElement(document.querySelector('.toast') as HTMLElement)
      act(() => { vi.advanceTimersByTime(1000) })
      expect(document.querySelector('.toast')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
