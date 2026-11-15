import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

/** The services of a compose file: each name with the lines of its block (the file's own two-space layout). */
function services(text: string): Map<string, string[]> {
  const lines = text.split(/\r?\n/)
  const start = lines.indexOf('services:')
  const found = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const name = /^ {2}([\w-]+):\s*$/.exec(line)
    if (name) { current = []; found.set(name[1], current); continue }
    if (current && /^ {4,}\S/.test(line)) current.push(line.trim())
  }
  return found
}

const line = (block: string[], key: string) => block.find(l => l.startsWith(`${key}:`))
const all = (text: string) => services(text).get('app')!

describe('docker-compose.yml', () => {
  it('one file with the app alone: no tunnel, no profiles, no secrets', () => {
    const text = read('docker-compose.yml')
    const all = services(text)
    expect([...all.keys()]).toEqual(['app'])
    // .env is optional: a new install runs on the defaults without it
    expect(all.get('app')!.join('\n')).toMatch(/env_file:\n- path: \.env\nrequired: false/)
    expect(line(all.get('app')!, 'profiles')).toBeUndefined()
    expect(text).not.toMatch(/cloudflared|tunnel|^secrets:/m)
    expect(existsSync(join(ROOT, 'docker-compose.tunnel.yml'))).toBe(false)
  })

  it('the data lives in the named volume data, not in a folder Docker would create as root', () => {
    const text = read('docker-compose.yml')
    expect(all(text)).toContain('- data:/data')
    expect(text).not.toContain('./data')
    expect(text.split(/\r?\n/)).toEqual(expect.arrayContaining(['volumes:', '  data:']))
  })

  it('the host port comes from APP_PORT (8080 by default), on localhost only; the container port stays 8080', () => {
    expect(read('docker-compose.yml')).toContain('- "127.0.0.1:${APP_PORT:-8080}:8080"')
    expect(read('.env.example')).toContain('# APP_PORT=8080')
  })

  it('the demo runs alone behind host Caddy, on loopback with no tunnel secret', () => {
    const text = read('deploy/demo/docker-compose.demo.yml')
    const blocks = services(text)
    expect([...blocks.keys()]).toEqual(['demo'])
    expect(blocks.get('demo')).toContain('- "127.0.0.1:8080:8080"')
    expect(blocks.get('demo')).toContain('CLIENT_IP_HEADER: X-Forwarded-For')
    expect(blocks.get('demo')).toContain('- demo-data:/data')
    expect(text).not.toMatch(/cloudflared|tunnel_token|tunnel-token|profiles:|^secrets:/m)
  })

  it('.env.example leaves special auth modes opt-in', () => {
    const lines = read('.env.example').split(/\r?\n/)
    expect(lines).toContain('# AUTH_MODE=none')
    expect(lines).toContain('# AUTH_MODE=demo')
    expect(lines.some(l => l.startsWith('AUTH_MODE='))).toBe(false)
  })

  it('.env.example, git and the image know no tunnel; the image context is an allowlist', () => {
    expect(read('.env.example')).not.toMatch(/COMPOSE_PROFILES|tunnel|TUNNEL_TOKEN/i)
    expect(read('.gitignore')).not.toContain('tunnel-token')
    // the image's context is an allowlist: everything not let in, .env included, stays out
    const rules = read('.dockerignore').split(/\r?\n/).filter(l => l && !l.startsWith('#'))
    expect(rules[0]).toBe('*')
    expect(rules.slice(1).every(r => r.startsWith('!') && !r.includes('.env'))).toBe(true)
  })
})
