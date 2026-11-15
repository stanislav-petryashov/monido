import { describe, expect, it } from 'vitest'
import { createLoginAttempts } from '../../src/server/loginAttempts'

describe('createLoginAttempts', () => {
  it('a confirmed code completes only for its own secret', () => {
    const logins = createLoginAttempts()
    const a = logins.start()
    const b = logins.start()
    expect(a.code).not.toBe(b.code)
    expect(a.secret).not.toBe(a.code)
    expect(logins.take(a.code, a.secret)).toEqual({ status: 'waiting' })
    expect(logins.approve(a.code, 7)).toBe(true)
    expect(logins.take(a.code, b.secret)).toEqual({ status: 'waiting' })
    expect(logins.take(a.code, '')).toEqual({ status: 'waiting' })
    expect(logins.take(a.code, a.secret)).toMatchObject({ status: 'done', userId: 7 })
    expect(logins.take(a.code, a.secret)).toEqual({ status: 'expired' })
    expect(logins.take(b.code, b.secret)).toEqual({ status: 'waiting' })
  })

  it('codes and secrets fit a Telegram deep link and a cookie', () => {
    const { code, secret } = createLoginAttempts().start()
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('an attempt expires after 5 minutes', () => {
    let now = 0
    const logins = createLoginAttempts({ now: () => now })
    const approved = logins.start()
    const waiting = logins.start()
    expect(logins.approve(approved.code, 1)).toBe(true)
    now = 299_999
    expect(logins.take(waiting.code, waiting.secret)).toEqual({ status: 'waiting' })
    now = 300_001
    expect(logins.approve(waiting.code, 1)).toBe(false)
    expect(logins.take(waiting.code, waiting.secret)).toEqual({ status: 'expired' })
    expect(logins.take(approved.code, approved.secret)).toEqual({ status: 'expired' })
  })

  it('approve is single-use', () => {
    const logins = createLoginAttempts()
    const { code, secret } = logins.start()
    expect(logins.approve(code, 1)).toBe(true)
    expect(logins.approve(code, 2)).toBe(false)
    expect(logins.take(code, secret)).toMatchObject({ status: 'done', userId: 1 })
    expect(logins.approve(code, 1)).toBe(false)
    expect(logins.approve('unknown', 1)).toBe(false)
  })

  it('take returns the time of the approval, not of the take', () => {
    let now = 1000
    const logins = createLoginAttempts({ now: () => now })
    const { code, secret } = logins.start()
    now = 2000
    expect(logins.approve(code, 7)).toBe(true)
    now = 9000
    expect(logins.take(code, secret)).toEqual({ status: 'done', userId: 7, approvedAt: 2000 })
  })

  it('a full store refuses a new start instead of dropping a live attempt; expired ones make room', () => {
    let now = 0
    const logins = createLoginAttempts({ max: 3, now: () => now })
    const started = Array.from({ length: 3 }, (_, i) => { now = i * 1000; return logins.start() })
    expect(() => logins.start()).toThrow(expect.objectContaining({ code: 'sign_in_attempts_full', status: 429 }))
    expect(started.map(s => logins.take(s.code, s.secret).status)).toEqual(['waiting', 'waiting', 'waiting'])
    now = 300_000
    const next = logins.start()
    expect(logins.take(next.code, next.secret).status).toBe('waiting')
    expect(started.map(s => logins.take(s.code, s.secret).status)).toEqual(['expired', 'waiting', 'waiting'])
  })

  it('a flood from many keys at their cap never evicts a lone attempt of another key', () => {
    const logins = createLoginAttempts({ max: 10, perKey: 3 })
    const family = logins.start(undefined, 'family')
    let started = 0, refused = 0
    // fewer keys than the store holds (the shortcut in loginAttempts.ts): some flooding key always holds more than one
    for (let k = 0; k < 8; k++) {
      for (let i = 0; i < 3; i++) {
        try { logins.start(undefined, `k${k}`); started++ } catch { refused++ }
      }
    }
    expect(started).toBeGreaterThan(9)
    expect(refused).toBeGreaterThan(0)
    expect(logins.take(family.code, family.secret).status).toBe('waiting')
  })

  it('a full store refuses the start when the requester\'s own key is the busiest', () => {
    const logins = createLoginAttempts({ max: 4, perKey: 3 })
    const mine = [logins.start(undefined, 'a'), logins.start(undefined, 'a')]
    const others = [logins.start(undefined, 'b'), logins.start(undefined, 'c')]
    expect(() => logins.start(undefined, 'a')).toThrow(expect.objectContaining({ code: 'sign_in_attempts_full', status: 429 }))
    expect([...mine, ...others].map(s => logins.take(s.code, s.secret).status)).toEqual(['waiting', 'waiting', 'waiting', 'waiting'])
    // another key takes the place of a's oldest
    const d = logins.start(undefined, 'd')
    expect([...mine, d].map(s => logins.take(s.code, s.secret).status)).toEqual(['expired', 'waiting', 'waiting'])
  })

  it('a flood of one attempt per key evicts nobody: the lone family attempt survives, the new start gets 429', () => {
    const logins = createLoginAttempts({ max: 3, perKey: 3 })
    const family = logins.start(undefined, 'family')
    logins.start(undefined, 'k1')
    logins.start(undefined, 'k2')
    expect(() => logins.start(undefined, 'k3')).toThrow(expect.objectContaining({ code: 'sign_in_attempts_full', status: 429 }))
    expect(logins.take(family.code, family.secret).status).toBe('waiting')
  })

  it('an attempt approved in Telegram is never evicted', () => {
    const logins = createLoginAttempts({ max: 3, perKey: 3 })
    const approved = logins.start(undefined, 'a')
    const waiting = logins.start(undefined, 'a')
    logins.start(undefined, 'b')
    expect(logins.approve(approved.code, 7)).toBe(true)
    logins.start(undefined, 'c')
    expect(logins.take(waiting.code, waiting.secret).status).toBe('expired')
    expect(logins.take(approved.code, approved.secret)).toMatchObject({ status: 'done', userId: 7 })
  })

  it('a full store evicts from the /48 group whose many /64 keys hold the most, not a lone family attempt', () => {
    const logins = createLoginAttempts({ max: 6, perKey: 3 })
    const family = logins.start(undefined, '2001:db8:9:1::/64', '2001:db8:9::/48')
    const other = logins.start(undefined, '198.51.100.1')
    // one attempt from each of four /64s inside one /48: no key above 1, yet the group holds four
    const flood = Array.from({ length: 4 }, (_, i) => logins.start(undefined, `2001:db8:1:${i}::/64`, '2001:db8:1::/48'))
    const fresh = logins.start(undefined, '203.0.113.9')
    expect(logins.take(flood[0].code, flood[0].secret).status).toBe('expired')
    expect([family, other, ...flood.slice(1), fresh].map(s => logins.take(s.code, s.secret).status)).toEqual(Array(6).fill('waiting'))
    // the group's own next start finds nobody busier and is refused
    expect(() => logins.start(undefined, '2001:db8:1:ff::/64', '2001:db8:1::/48')).toThrow(expect.objectContaining({ code: 'sign_in_attempts_full' }))
  })

  it('one client key holds at most perKey live attempts; other keys are not affected', () => {
    const logins = createLoginAttempts({ perKey: 2 })
    const first = logins.start(undefined, '203.0.113.7')
    logins.start(undefined, '203.0.113.7')
    expect(() => logins.start(undefined, '203.0.113.7')).toThrow(expect.objectContaining({ code: 'sign_in_attempts_full' }))
    expect(logins.start(undefined, '198.51.100.1').code).toMatch(/^[A-Za-z0-9_-]{22}$/)
    logins.cancel(first.code, first.secret)
    expect(logins.start(undefined, '203.0.113.7').code).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })
})
