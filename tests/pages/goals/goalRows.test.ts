import { rowOf } from '../../../src/pages/goals/goalRows'
import { UNREAD_DATE } from '../../../src/pages/admin/dateMask'
import type { GoalFields } from '../../../src/pages/goals/GoalForm'

const valid: GoalFields = { name: 'Trip', target: '1000', current: '', target_date: '2027-06-30', currency: 'USD', fire: '' }

it.each(['', UNREAD_DATE])('reports a missing or unfinished date as a month error: %s', target_date => {
  expect(rowOf({ ...valid, target_date }, 'trip')).toEqual({ row: null, error: 'goalsPage.form.needMonth' })
})

it.each([{ name: ' ' }, { target: '' }, { current: 'bad' }])('returns the cause of invalid goal fields: %j', patch => {
  expect(rowOf({ ...valid, ...patch }, 'trip')).toEqual({ row: null, error: 'name' in patch ? 'goalsPage.form.needName' : 'goalsPage.form.needAmount' })
})

it('keeps a blank current amount as zero and trims the name', () => {
  expect(rowOf({ ...valid, name: ' Trip ' }, 'trip')).toMatchObject({ row: { id: 'trip', name: 'Trip', target: 1000, current: 0 }, error: null })
})
