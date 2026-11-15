import { describe, expect, it } from 'vitest'
import { newPasswordProblem, PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from '../../src/domain/password'

describe('passwordProblem', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(PASSWORD_MIN).toBe(12)
    expect(PASSWORD_MAX).toBe(128)
    expect(passwordProblem('a'.repeat(11))).toBe('password_too_short')
    const emoji = '\u{1F600}'.repeat(12)
    expect(emoji.length).toBe(24)
    expect(passwordProblem(emoji)).toBeNull()
    expect(passwordProblem('\u{1F600}'.repeat(11))).toBe('password_too_short')
    expect(passwordProblem('a'.repeat(128))).toBeNull()
    expect(passwordProblem('a'.repeat(129))).toBe('password_too_long')
  })

  it('keeps spaces: they count like any character', () => {
    expect(passwordProblem('  twelve chars  ')).toBeNull()
    expect(passwordProblem('     a      ')).toBeNull()
  })
})

describe('newPasswordProblem', () => {
  it('the password\'s own problem before the mismatch, then the mismatch, then null', () => {
    expect(newPasswordProblem('short', 'other')).toBe('password_too_short')
    expect(newPasswordProblem('x'.repeat(PASSWORD_MAX + 1), '')).toBe('password_too_long')
    expect(newPasswordProblem('a long family password', 'a long family passwor')).toBe('mismatch')
    expect(newPasswordProblem('a long family password', 'a long family password')).toBeNull()
  })
})
