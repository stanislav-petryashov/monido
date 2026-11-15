/**
 * An in-memory localStorage or sessionStorage, installed with vi.stubGlobal (so it is resolved at call time and undone
 * by vi.unstubAllGlobals). The environment's own is not used: in Node 25+ it shadows jsdom's and does not work without
 * --localstorage-file. Returns the backing map; failReads / failWrites make getItem / setItem throw.
 */
export function stubStorage(
  kind: 'local' | 'session',
  initial: Record<string, string> = {},
  opts: { failReads?: boolean; failWrites?: boolean } = {},
) {
  const data = new Map(Object.entries(initial))
  vi.stubGlobal(kind === 'local' ? 'localStorage' : 'sessionStorage', {
    getItem: (k: string) => { if (opts.failReads) throw new Error('blocked'); return data.get(k) ?? null },
    setItem: (k: string, v: string) => { if (opts.failWrites) throw new Error('blocked'); data.set(k, String(v)) },
    removeItem: (k: string) => { data.delete(k) },
    clear: () => data.clear(),
  })
  return data
}
