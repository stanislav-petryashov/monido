import { hashPassword, verifyHash } from '../../src/server/authSettings'

// the one file that runs scrypt at the production cost: tests/setup.node.ts swaps N = 2^16 for 16 everywhere else
vi.unmock('node:crypto')

// written before N was raised, by node:crypto scryptSync('correct horse', salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 MiB })
const OLD_HASH = 'scrypt$32768$8$1$ZmFtaWx5LWNhcGl0YWwtMQ==$z9I7BJq/fevnOpLV31S6BrY981Kd6NPzcvDj0sk6qnQ='

describe('scrypt at the production parameters', () => {
  it('still verifies a hash stored with the old N = 2^15', async () => {
    expect(await verifyHash('correct horse', OLD_HASH)).toBe(true)
    expect(await verifyHash('wrong horse', OLD_HASH)).toBe(false)
  })

  it('a fresh hash says N = 2^16, r = 8, p = 2 (64 MiB, over the 32 MiB default maxmem) and round-trips', async () => {
    const stored = await hashPassword('correct horse')
    expect(stored).toMatch(/^scrypt\$65536\$8\$2\$/)
    expect(await verifyHash('correct horse', stored)).toBe(true)
  })
})
