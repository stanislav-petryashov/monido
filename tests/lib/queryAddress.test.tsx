import { act, renderHook, waitFor } from '@testing-library/react'
import { setQueryParams, useQuerySearch } from '../../src/lib/queryAddress'
import { usePageState } from '../../src/pages/cashflow/period'
import { setParam, useParam } from '../../src/pages/goals/address'

afterEach(() => window.history.replaceState(null, '', '/'))

it('updates both page readers while retaining unrelated parameters, hash and history state', () => {
  const state = { __familyFinancePosition: 5, custom: true }
  window.history.replaceState(state, '', '/cashflow?keep=1#section')
  const { result } = renderHook(() => ({ period: usePageState(), goal: useParam('goal') }))
  const length = window.history.length
  act(() => result.current.period[1]({ kind: 'year', month: '2026-10', category: 7 }))
  act(() => setParam('goal', 'Trip & home'))
  expect(result.current.period[0]).toEqual({ kind: 'year', month: '2026-10', category: 7 })
  expect(result.current.goal).toBe('Trip & home')
  expect(window.location.hash).toBe('#section')
  expect(new URLSearchParams(window.location.search).get('keep')).toBe('1')
  expect(window.history.state).toEqual(state)
  expect(window.history.length).toBe(length)
  act(() => result.current.period[1]({ kind: 'month', month: null, category: null }))
  expect(window.location.search).toBe('?keep=1&goal=Trip+%26+home')
})

it('pushes a selection that the browser Back button restores and notifies', async () => {
  window.history.replaceState({ marker: true }, '', '/goals?goal=first')
  const { result } = renderHook(() => useQuerySearch())
  const length = window.history.length
  act(() => setQueryParams({ goal: 'second' }, true))
  expect(window.history.length).toBe(length + 1)
  expect(result.current).toBe('?goal=second')
  act(() => window.history.back())
  await waitFor(() => expect(result.current).toBe('?goal=first'))
  expect(window.history.state).toEqual({ marker: true })
})
