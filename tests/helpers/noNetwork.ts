import net from 'node:net'

// The no-network guard, installed by tests/setup.ts in every project: a test reaches no host but this machine.
// A fetch or a socket connect to any other host fails at once with a message naming the host, and the attempt is
// recorded, so the test fails in afterEach even when the code under test swallows the error. Loopback stays open
// (tests/server/main.test.ts and the demo server tests start real local servers). A test that stubs fetch replaces
// the guard for its duration (vi.stubGlobal; unstubGlobals puts the guard back).

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
// 127.0.0.0/8 as an address only: a name like 127.example.com may resolve anywhere
const isLoopback = (host: string) => LOOPBACK.has(host) || (net.isIPv4(host) && host.startsWith('127.'))

// builtins are shared by every vm context of a worker (pool vmThreads): the socket patch and the record live on them
const KEY = Symbol.for('familyFinance.noNetwork')
type Shared = { blocked: string[] }
const proto = net.Socket.prototype as unknown as Record<symbol, Shared | undefined>
const shared: Shared = proto[KEY] ?? { blocked: [] }

function block(what: string): Error {
  const message = `no network in tests: ${what}`
  shared.blocked.push(message)
  return new Error(message)
}

function fetchHost(input: RequestInfo | URL): string {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    return new URL(url, 'http://localhost').hostname
  } catch {
    return 'localhost'
  }
}

/** Installs the guard on this context's fetch and, once per worker, on net.Socket's connect. */
export function installNoNetwork(): void {
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const host = fetchHost(input)
    return isLoopback(host) ? realFetch(input, init) : Promise.reject(block(`fetch to ${host}`))
  }) as typeof fetch

  if (proto[KEY]) return
  proto[KEY] = shared
  const realConnect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0]
    const opts = typeof first === 'object' && first !== null ? (first as { host?: string; path?: string }) : null
    // a unix socket path or a bare port (`connect(port, host?)`) — the host defaults to localhost
    const host = opts ? (opts.path ? 'localhost' : (opts.host ?? 'localhost')) : typeof args[1] === 'string' ? args[1] : 'localhost'
    if (!isLoopback(host)) throw block(`socket to ${host}`)
    return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args)
  } as typeof net.Socket.prototype.connect
}

/** The blocked attempts since the last call, cleared. tests/setup.ts fails a test that made any. */
export function takeBlocked(): string[] {
  return shared.blocked.splice(0)
}
