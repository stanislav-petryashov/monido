import { beforeEach, vi } from 'vitest'
import { forgetFxMemory } from '../src/server/fx'

// the node project only (vitest.config.ts), after tests/setup.ts.
// scrypt at the production cost (N = 2^16, p = 2) is ~200 ms a call and the server tests hash hundreds of passwords: here
// N = 2^16 runs as N = 16. The stored string still says 65536 and verification asks the same swap, so hashes round-trip;
// any other N (2^30 for the maxmem refusal) runs as asked. tests/server/scryptParams.test.ts unmocks it and checks the
// real parameters.
vi.mock('node:crypto', async importOriginal => {
  const crypto = await importOriginal<typeof import('node:crypto')>()
  const cheap = <T extends { N?: number }>(options: T): T => (options?.N === 2 ** 16 ? { ...options, N: 16 } : options)
  const scrypt = ((password: never, salt: never, keylen: number, options: never, callback: never) =>
    typeof options === 'function'
      ? crypto.scrypt(password, salt, keylen, options)
      : crypto.scrypt(password, salt, keylen, cheap(options), callback)) as typeof crypto.scrypt
  const scryptSync = ((password: never, salt: never, keylen: number, options?: never) =>
    crypto.scryptSync(password, salt, keylen, options && cheap(options))) as typeof crypto.scryptSync
  return { ...crypto, default: { ...crypto, scrypt, scryptSync }, scrypt, scryptSync }
})

// fx.ts remembers a failed download for 5 minutes: one test's offline fetch would hold back the next test's downloads
beforeEach(forgetFxMemory)
