import { StrictMode, useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useUnsavedChanges } from '../../src/lib/useUnsavedChanges'
import { navigate, useRoute } from '../../src/lib/router'
import { NotifyProvider } from '../../src/components/NotifyProvider'
import { AuthGate } from '../../src/components/AuthGate'
import { logout, markUnauthorized, setAuth } from '../../src/lib/authState'
import { renderAdmin } from '../helpers/render'
import { jsonResponse } from '../helpers/http'

function Editor({ risk }: { risk?: boolean }) {
  const [value, setValue] = useState('')
  useUnsavedChanges(risk ?? value !== '')
  return <input aria-label="Draft" value={value} onChange={e => setValue(e.target.value)} />
}
function Routes() {
  const path = useRoute()
  return path === '/' ? <Editor /> : <p>{path}</p>
}
const unload = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}
beforeEach(() => history.replaceState(null, '', '/'))

it('cancel retains the input and focus; accepting commits once despite repeated clicks', async () => {
  render(<NotifyProvider><Routes /></NotifyProvider>)
  const field = screen.getByRole('textbox')
  fireEvent.change(field, { target: { value: 'unfinished' } })
  field.focus()
  act(() => { navigate('/goals'); navigate('/cashflow') })
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(field).toHaveValue('unfinished')
  expect(field).toHaveFocus()
  expect(location.pathname).toBe('/')
  act(() => { navigate('/goals'); navigate('/cashflow') })
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
  await screen.findByText('/goals')
  expect(unload()).toBe(false)
})

it('registers only live risk through StrictMode, successful save and unmount', async () => {
  const view = render(<StrictMode><NotifyProvider><Editor risk /></NotifyProvider></StrictMode>)
  expect(unload()).toBe(true)
  view.rerender(<StrictMode><NotifyProvider><Editor risk={false} /></NotifyProvider></StrictMode>)
  expect(unload()).toBe(false)
  await act(async () => navigate('/goals'))
  expect(location.pathname).toBe('/goals')
  expect(screen.queryByRole('dialog')).toBeNull()
  view.rerender(<StrictMode><NotifyProvider><Editor risk /></NotifyProvider></StrictMode>)
  expect(unload()).toBe(true)
  view.unmount()
  expect(unload()).toBe(false)
  act(() => navigate('/cashflow'))
  expect(location.pathname).toBe('/cashflow')
})

it.each(['session loss', 'sign-out'])('%s removes the protected editor while a discard question is pending', async reason => {
  setAuth({ mode: 'password', authenticated: true })
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
  renderAdmin(<AuthGate><Editor risk /></AuthGate>)
  act(() => navigate('/goals'))
  await screen.findByRole('dialog')
  await act(async () => { if (reason === 'sign-out') await logout(); else markUnauthorized() })
  expect(screen.queryByLabelText('Draft')).toBeNull()
  expect(unload()).toBe(false)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(location.pathname).toBe('/')
  expect(screen.queryByLabelText('Draft')).toBeNull()
})

it('accepting departure still works when autosave finishes while the question is open', async () => {
  const view = render(<NotifyProvider><Editor risk /></NotifyProvider>)
  act(() => navigate('/goals'))
  await screen.findByRole('dialog')
  view.rerender(<NotifyProvider><Editor risk={false} /></NotifyProvider>)
  expect(unload()).toBe(false)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
  await waitFor(() => expect(location.pathname).toBe('/goals'))
})

it('unmount releases a pending Back traversal without waiting for its stale answer', async () => {
  act(() => navigate('/editor'))
  const view = render(<NotifyProvider><Editor risk /></NotifyProvider>)
  act(() => history.back())
  await screen.findByRole('dialog')
  view.rerender(<NotifyProvider><p>Signed out</p></NotifyProvider>)
  act(() => navigate('/signed-out'))
  expect(location.pathname).toBe('/signed-out')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(location.pathname).toBe('/signed-out')
})

it('cancelled Back keeps the same mounted editable field and its typed value', async () => {
  render(<NotifyProvider><Routes /></NotifyProvider>)
  await act(async () => navigate('/goals'))
  act(() => navigate('/'))
  const field = screen.getByRole('textbox')
  fireEvent.change(field, { target: { value: '12.' } })
  field.focus()
  act(() => history.back())
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  await act(async () => {})
  expect(location.pathname).toBe('/')
  expect(screen.getByRole('textbox')).toBe(field)
  expect(field).toHaveValue('12.')
  expect(field).toHaveFocus()
  fireEvent.change(field, { target: { value: '12.5' } })
  expect(field).toHaveValue('12.5')
  act(() => history.back())
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
  await screen.findByText('/goals')
})

it.each([true, false])('keeps editor history when answering the dialog during a browser Back (allow: %s)', async allowed => {
  act(() => navigate('/previous'))
  act(() => navigate('/'))
  render(<NotifyProvider><Routes /></NotifyProvider>)
  const field = screen.getByRole('textbox')
  fireEvent.change(field, { target: { value: 'still editing' } })
  field.focus()
  const length = history.length
  act(() => navigate('/goals'))
  const dialog = await screen.findByRole('dialog')
  await act(async () => {
    await new Promise<void>(resolve => {
      window.addEventListener('popstate', () => resolve(), { once: true })
      history.back()
    })
    expect(location.pathname).toBe('/previous')
    fireEvent.click(within(dialog).getByRole('button', { name: allowed ? 'Discard changes' : 'Cancel' }))
  })
  await waitFor(() => expect(location.pathname).toBe(allowed ? '/goals' : '/'))
  expect(history.length).toBe(length + (allowed ? 1 : 0))
  expect(screen.queryByRole('dialog')).toBeNull()
  if (allowed) {
    await screen.findByText('/goals')
    act(() => history.back())
    await screen.findByRole('textbox')
    expect(location.pathname).toBe('/')
  } else {
    expect(screen.getByRole('textbox')).toBe(field)
    expect(field).toHaveValue('still editing')
    expect(field).toHaveFocus()
  }
})
