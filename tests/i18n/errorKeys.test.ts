import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { expect, it } from 'vitest'
import en from '../../src/locales/en-US.json'
import { ROOT, srcFiles } from '../helpers/repoFiles'


/**
 * Error codes written as literals: `new InputError('<code>'`, `new TelegramError('<code>'` (the bot's client; reminders store them in last_error),
 * `errorJson('<code>'`, `conflict: '<code>'`, `failure: '<code>'` (or its default `failure = '<code>'`).
 */
const CODE = /(?:new (?:InputError|TelegramError)\(|errorJson\(|(?:conflict|failure)(?:: | = ))'([^']+)'/g

const sources = srcFiles(/\.tsx?$/).map(path => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }))
const codes = sources.flatMap(({ path, text }) => [...text.matchAll(CODE)].map(m => ({ path, code: m[1] })))

const lookup = (key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)

it('finds the error codes of the server', () => {
  expect(codes.map(c => c.code)).toEqual(expect.arrayContaining(['wrong_password', 'month_out_of_order', 'save_failed', 'reminders.no_chat', 'reminders.send_failed', 'telegram.webhook', 'telegram.other_reader']))
})

it('every error code has its text in en-US.json under errors.<code>', () => {
  const missing = codes.filter(({ code }) => typeof lookup(`errors.${code}`) !== 'string').map(({ path, code }) => `${path}: errors.${code}`)
  expect(missing).toEqual([])
})

it('codes are snake_case, module codes prefixed with the module key', () => {
  const bad = codes.filter(({ code }) => !/^(?:[a-z]+(?:_[a-z]+)*\.)?[a-z]+(?:_[a-z]+)*$/.test(code)).map(({ path, code }) => `${path}: ${code}`)
  expect(bad).toEqual([])
})
