import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { accountKey } from '../../../src/domain/accounts'
import type { DraftRequest } from '../../../src/domain/api'
import { ConfirmContext, ToastContext } from '../../../src/lib/notifyState'
import { useMonthClose } from '../../../src/pages/admin/useMonthClose'
import { base, stubState } from '../../helpers/monthClose'
import { testClient } from '../../helpers/render'

async function load(flows = true) {
  const client = testClient()
  stubState({ ...base, flows }, (_, init) => ({
    ...base, flows, draftRevision: 'revision-2', rows: (JSON.parse(String(init.body)) as DraftRequest).rows,
  }))
  const { result } = renderHook(useMonthClose, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <ToastContext.Provider value={{ success: vi.fn(), error: vi.fn() }}>
          <ConfirmContext.Provider value={async () => true}>{children}</ConfirmContext.Provider>
        </ToastContext.Provider>
      </QueryClientProvider>
    ),
  })
  await waitFor(() => expect(result.current.loaded).toBe(true))
  return result
}

const key = accountKey('Quillmark Bank', 'Robin')

it('copies the previous balance and zero flows together; undo survives saving but not a manual edit or reload', async () => {
  const result = await load()
  act(() => result.current.markUnchanged(key))
  expect(result.current.rows[0]).toMatchObject({ balance: 5800, active: 0, passive: 0, expense: 0 })
  await act(async () => { await result.current.save() })
  expect(result.current.canUndoUnchanged(result.current.rows[0]!)).toBe(true)
  act(() => result.current.undoUnchanged(key))
  expect(result.current.rows[0]).toEqual(base.rows[0])
  act(() => result.current.markUnchanged(key))
  act(() => result.current.edit(key, 'expense', 17))
  act(() => result.current.undoUnchanged(key))
  expect(result.current.rows[0]?.expense).toBe(17)
  act(() => result.current.adopt(base))
  expect(result.current.canUndoUnchanged(result.current.rows[0]!)).toBe(false)
})

it('preserves invalid text and entered amounts when filling empty flows', async () => {
  const result = await load()
  act(() => result.current.edit(key, 'passive', 27))
  act(() => result.current.edit(key, 'active', null, true))
  act(() => result.current.markUnchanged(key))
  act(() => result.current.fillEmptyFlows(key))
  expect(result.current.rows[0]).toMatchObject({ balance: null, active: null, passive: 27 })
  expect(result.current.unreadable).toContain(key + '|active')
  act(() => result.current.edit(key, 'active', null))
  act(() => result.current.fillEmptyFlows(key))
  expect(result.current.rows[0]).toMatchObject({ balance: null, active: 0, passive: 27, expense: 0 })
})

it('copies only the balance when cash flow is disabled', async () => {
  const result = await load(false)
  act(() => result.current.markUnchanged(key))
  expect(result.current.rows[0]).toMatchObject({ balance: 5800, active: null, passive: null, expense: null })
})

it('requires an actual previous balance and preserves investment transfers', async () => {
  const result = await load()
  const row = { ...base.rows[0]!, class: 'broker' as const }
  act(() => result.current.adopt({ ...base, rows: [row], hints: {} }))
  expect(result.current.canMarkUnchanged(row)).toBe(false)
  act(() => result.current.adopt({ ...base, rows: [{ ...row, deposited: 200 }] }))
  act(() => result.current.markUnchanged(key))
  expect(result.current.rows[0]).toMatchObject({ balance: null, deposited: 200 })
  act(() => result.current.adopt({ ...base, rows: [row], hints: { [key]: 0 } }))
  act(() => result.current.markUnchanged(key))
  expect(result.current.rows[0]).toMatchObject({ balance: 0, deposited: 0 })
  act(() => result.current.undoUnchanged(key))
  expect(result.current.rows[0]).toMatchObject({ balance: null, deposited: null })
})
