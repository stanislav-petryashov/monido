import { holdingHref, recordFromHash, recordHref } from '../../src/lib/recordLink'

afterEach(() => window.history.replaceState(null, '', '/'))

describe('recordHref and recordFromHash', () => {
  it('round-trips a key with spaces, a bar and non-ASCII letters', () => {
    const key = 'Brisaluna Bank|Robin & Noa Ü'
    window.history.replaceState(null, '', recordHref('/accounts', key))
    expect(window.location.pathname).toBe('/accounts')
    expect(recordFromHash()).toBe(key)
  })

  it('round-trips a key with #, %, / and an emoji, keeping them out of the path and the fragment', () => {
    const key = 'a#b%/c 🏠|x'
    const href = recordHref('/accounts', key)
    expect(href.split('#')).toHaveLength(2)
    window.history.replaceState(null, '', href)
    expect(window.location.pathname).toBe('/accounts')
    expect(recordFromHash()).toBe(key)
  })

  it('names no record without a hash, with an empty hash, or with a malformed one', () => {
    expect(recordFromHash()).toBeNull()
    window.history.replaceState(null, '', '/loans#')
    expect(recordFromHash()).toBeNull()
    window.history.replaceState(null, '', '/loans#%')
    expect(recordFromHash()).toBeNull()
  })
})

it('uses account ownership, preserves encoded record names and omits unavailable modules', () => {
  const paths = { account: '/accounts', realEstate: '/property' }
  const row = { kind: 'account' as const, name: 'Bank #1', member: 'Alex' }
  expect(holdingHref(paths, row)).not.toBe(holdingHref(paths, { ...row, member: 'Sam' }))
  expect(holdingHref(paths, { ...row, kind: 'realEstate' })).toBe(recordHref('/property', 'Bank #1'))
  expect(holdingHref(paths, { ...row, kind: 'loan' })).toBeNull()
})
