import { errorText } from '../../src/lib/notifyState'

describe('errorText', () => {
  it('takes the message of an Error', () => {
    expect(errorText(new Error('Row 14 not found'))).toBe('Row 14 not found')
  })

  it('drops the "Error: " prefix of a stringified error', () => {
    expect(errorText('Error: HTTP 500')).toBe('HTTP 500')
  })

  it('cuts a long server trace to 300 characters', () => {
    const text = errorText(new Error('x'.repeat(1000)))
    expect(text).toHaveLength(300)
    expect(text.endsWith('…')).toBe(true)
  })

  it('turns other values into text', () => {
    expect(errorText({ toString: () => 'no network' })).toBe('no network')
    expect(errorText(undefined)).toBe('')
  })
})
