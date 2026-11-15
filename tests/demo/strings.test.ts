import en from '../../src/demo/en-US.json'
import ru from '../../src/demo/ru-RU.json'
import type { DemoStrings } from '../../src/demo/strings'
import { RUB_PER_USD_BY_MONTH } from '../../src/demo/rubRates'
import { DEMO_STRING_KEYS } from '../../src/demo/strings'

// the JSON files must satisfy the interface (checked by tsc)
const typedEn: DemoStrings = en
const typedRu: DemoStrings = ru

const flatten = (o: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => typeof v === 'object' && v ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`])
const leaves = (o: Record<string, unknown>): string[] =>
  Object.values(o).flatMap(v => typeof v === 'object' && v ? leaves(v as Record<string, unknown>) : [String(v)])

it('both files hold exactly the DemoStrings keys', () => {
  expect([typedEn, typedRu]).toHaveLength(2)
  expect(flatten(en).sort()).toEqual([...DEMO_STRING_KEYS].sort())
  expect(flatten(ru).sort()).toEqual([...DEMO_STRING_KEYS].sort())
})
it('every Russian string has Cyrillic, no English one does', () => {
  expect(leaves(ru).filter(s => !/\p{Script=Cyrillic}/u.test(s))).toEqual([])
  expect(leaves(en).filter(s => /\p{Script=Cyrillic}/u.test(s))).toEqual([])
})
it('no string is empty', () => {
  expect([...leaves(en), ...leaves(ru)].filter(s => s.trim() === '')).toEqual([])
})

it('the RUB table has a positive rate for every month from 2023-01, oldest first', () => {
  const months = Object.keys(RUB_PER_USD_BY_MONTH)
  expect(months[0]).toBe('2023-01')
  expect(months).toEqual([...months].sort())
  expect(months.every(m => /^\d{4}-\d{2}$/.test(m))).toBe(true)
  expect(Object.values(RUB_PER_USD_BY_MONTH).filter(r => !(r > 0))).toEqual([])
})
