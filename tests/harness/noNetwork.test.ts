import { createServer, type Server } from 'node:http'
import net, { type AddressInfo } from 'node:net'
import { takeBlocked } from '../helpers/noNetwork'

// the guard tests/setup.ts installs in every project (tests/helpers/noNetwork.ts)
describe('no-network guard', () => {
  let server: Server
  let port: number
  beforeAll(async () => {
    server = createServer((_req, res) => res.end('local'))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

  it('rejects a fetch to an outside host with its name and records it', async () => {
    await expect(fetch('https://rates.example.com/v1/latest')).rejects.toThrow('no network in tests: fetch to rates.example.com')
    await expect(fetch(new Request('https://example.com/x'))).rejects.toThrow('fetch to example.com')
    expect(takeBlocked()).toEqual([
      'no network in tests: fetch to rates.example.com',
      'no network in tests: fetch to example.com',
    ])
  })

  it('treats a name that only starts like a loopback address as an outside host', async () => {
    await expect(fetch('https://127.example.com/')).rejects.toThrow('fetch to 127.example.com')
    expect(() => net.connect({ host: '127.example.com', port: 443 })).toThrow('socket to 127.example.com')
    expect(takeBlocked()).toEqual(['no network in tests: fetch to 127.example.com', 'no network in tests: socket to 127.example.com'])
  })

  it('throws on a socket connect to an outside host', () => {
    expect(() => net.connect({ host: 'example.com', port: 443 })).toThrow('no network in tests: socket to example.com')
    expect(() => new net.Socket().connect(443, 'example.org')).toThrow('socket to example.org')
    expect(takeBlocked()).toEqual(['no network in tests: socket to example.com', 'no network in tests: socket to example.org'])
  })

  it.each(['127.0.0.1', 'localhost'])('lets a fetch to %s through', async host => {
    const res = await fetch(`http://${host}:${port}/`)
    expect(await res.text()).toBe('local')
    expect(takeBlocked()).toEqual([])
  })

  it('lets a socket to loopback through', async () => {
    const socket = net.connect({ host: '127.0.0.1', port })
    await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('error', reject))
    socket.destroy()
    expect(takeBlocked()).toEqual([])
  })
})
