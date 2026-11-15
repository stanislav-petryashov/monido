import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { applyDateFormat } from '../../src/lib/dateFormat'
import { useDateText } from '../../src/pages/admin/ui/useDateText'
import { UNREAD_DATE } from '../../src/pages/admin/dateMask'

afterEach(() => applyDateFormat(null))
it('keeps an unfinished date in its original order until it is completed', () => {
  applyDateFormat('dmy')
  const { result, rerender } = renderHook(() => {
    const [value, setValue] = useState('')
    return { value, ...useDateText(value, setValue, 'dmy', iso => iso) }
  })
  act(() => result.current.set('03.04.'))
  expect(result.current.value).toBe(UNREAD_DATE)
  applyDateFormat('mdy')
  rerender()
  act(() => result.current.set('03.04.2026'))
  expect(result.current.value).toBe('2026-04-03')
  expect(result.current.text).toBe('04.03.2026')
})
