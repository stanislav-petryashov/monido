import { describe, expect, it } from 'vitest'
import { accountKey, resolveAccountLink, latestPerAccount, listAccounts, normalizeClass } from '../../src/domain/accounts'

describe('normalizeClass', () => {
  it('keeps current classes and maps legacy ones', () => {
    expect(normalizeClass('bank')).toBe('bank')
    expect(normalizeClass('crypto')).toBe('crypto')
    expect(normalizeClass('investments')).toBe('broker')
    expect(normalizeClass('business')).toBe('other')
    expect(normalizeClass('')).toBe('other')
  })
})

describe('accountKey', () => {
  it('treats a missing member as an empty one, like the list of accounts does', () => {
    expect(accountKey('Quillmark Bank', null)).toBe('["Quillmark Bank",""]')
    expect(accountKey('Quillmark Bank', '')).toBe('["Quillmark Bank",""]')
    expect(accountKey('Quillmark Bank', 'Robin')).toBe('["Quillmark Bank","Robin"]')
  })
})

describe('latestPerAccount', () => {
  it('keeps the latest row of each account; on equal dates the later row wins', () => {
    const rows = [
      { date: '2031-09-30', name: 'A', member: 'Robin', value: 7 },
      { date: '2031-08-31', name: 'A', member: 'Robin', value: 13 },
      { date: '2031-09-30', name: 'A', member: null, value: 21 },
      { date: '2031-09-30', name: 'A', member: 'Robin', value: 34 },
    ]
    expect(latestPerAccount(rows).map(r => r.value)).toEqual([34, 21])
  })
})

describe('listAccounts', () => {
  it('returns one account per name and member, typed by the latest row', () => {
    const accounts = listAccounts([
      { date: '2031-08-31', class: 'bank', name: 'Ottergate Brokerage', currency: 'EUR', member: 'Shared' },
      { date: '2031-09-30', class: 'broker', name: 'Ottergate Brokerage', currency: 'EUR', member: 'Shared' },
      { date: '2031-09-30', class: 'bank', name: 'Quillmark Bank', currency: 'USD', member: 'Robin' },
      { date: '2031-09-30', class: 'bank', name: 'Quillmark Bank', currency: 'USD', member: null },
    ])
    expect(accounts).toEqual([
      { bank: 'Quillmark Bank', member: '', currency: 'USD', class: 'bank' },
      { bank: 'Quillmark Bank', member: 'Robin', currency: 'USD', class: 'bank' },
      { bank: 'Ottergate Brokerage', member: 'Shared', currency: 'EUR', class: 'broker' },
    ])
  })
})

describe('account identity links', () => {
  it('keeps pipe-colliding identities distinct', () => {
    expect(accountKey('A|B', 'C')).not.toBe(accountKey('A', 'B|C'))
    const rows = [
      { date: '2031-05-31', name: 'A|B', member: 'C', value: 10 },
      { date: '2031-05-31', name: 'A', member: 'B|C', value: 20 },
    ]
    expect(latestPerAccount(rows).map(r => r.value)).toEqual([10, 20])
    const names = ['A"[', 'A\\', 'loan:Debt', 'A|balance']
    expect(new Set(names.flatMap(name => [accountKey(name, ''), accountKey('', name)])).size).toBe(8)
    expect(accountKey('A', undefined)).toBe(accountKey('A', null))
  })

  it('refuses ambiguous legacy links', () => {
    const accounts = [{ name: 'A|B', member: 'C' }, { name: 'A', member: 'B|C' }]
    expect(resolveAccountLink('A|B|C', accounts)).toBeNull()
    expect(resolveAccountLink('A|B|C', [accounts[0]])).toBe('["A|B","C"]')
    expect(resolveAccountLink('["A","B|C"]', accounts)).toBe('["A","B|C"]')
    expect(resolveAccountLink('gone|', accounts)).toBeNull()
    expect(resolveAccountLink('A|', [{ name: 'A' }, { name: 'A', member: null }])).toBe('["A",""]')
  })

  it('prefers an exact current key over a matching legacy key', () => {
    const current = '["A|","B"]'
    expect(resolveAccountLink(current, [{ name: '["A', member: '","B"]' }, { name: 'A|', member: 'B' }])).toBe(current)
  })
})
