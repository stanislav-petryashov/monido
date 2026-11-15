// the config's mockReset (vitest.config.ts): what one test leaves on a module-scope vi.fn is gone in the next
const answer = vi.fn(() => 'created with')

describe('a module-scope vi.fn between tests', { shuffle: false }, () => {
  it('a test queues once-values and a later implementation, and calls the mock', () => {
    answer()
    answer.mockReturnValueOnce('left over')
    answer.mockImplementationOnce(() => 'left over too')
    answer.mockImplementation(() => 'set later')
  })

  it('the next test gets the implementation the mock was created with, and no calls', () => {
    expect(answer.mock.calls).toEqual([])
    expect([answer(), answer(), answer()]).toEqual(['created with', 'created with', 'created with'])
  })
})
