import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Hono } from 'hono'
import { mountStatic } from '../../src/server/static'
import { withTempDirs } from '../helpers/tmp'

const tempDir = withTempDirs('ffd-static-')

/** The built client in a temporary folder that afterEach removes. */
function site() {
  const base = tempDir()
  const root = join(base, 'client')
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>')
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)')
  mkdirSync(join(root, '.vite'))
  writeFileSync(join(root, '.vite', 'manifest.json'), '{"src/main.tsx":{}}')
  writeFileSync(join(root, '.env'), 'SECRET=1')
  writeFileSync(join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"></svg>')
  writeFileSync(join(base, 'secret.txt'), 'top secret')
  const app = new Hono()
  app.get('/api/ping', c => c.json({ pong: true }))
  mountStatic(app, relative(process.cwd(), root))
  return app
}

describe('static files', () => {
  it('serves hashed assets as immutable and index.html as no-cache', async () => {
    const app = site()
    const asset = await app.request('/assets/app-abc123.js')
    expect(asset.status).toBe(200)
    expect(asset.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    const index = await app.request('/')
    expect(await index.text()).toContain('id="root"')
    expect(index.headers.get('Cache-Control')).toBe('no-cache')
  })

  it('serves /favicon.svg as an image, not as the SPA page', async () => {
    const res = await site().request('/favicon.svg')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('image/svg+xml')
    expect(await res.text()).toContain('<svg')
  })

  it('falls back to index.html for deep links but not for /api', async () => {
    const app = site()
    for (const path of ['/capital', '/loans', '/goals', '/accounts', '/real-estate']) {
      const res = await app.request(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('id="root"')
    }
    expect(await (await app.request('/api/ping')).json()).toEqual({ pong: true })
    expect((await app.request('/api/unknown')).status).toBe(404)
  })

  it('answers 404 for a missing asset and for bare /api instead of the SPA page', async () => {
    const app = site()
    app.notFound(c => c.text('Not found', 404))
    for (const path of ['/assets/app-old999.js', '/assets/', '/api']) {
      const res = await app.request(path)
      expect(res.status).toBe(404)
      expect(await res.text()).not.toContain('id="root"')
    }
  })

  it('answers 404 for any path segment starting with a dot, without the SPA page', async () => {
    const app = site()
    app.notFound(c => c.text('Not found', 404))
    for (const path of ['/.vite/manifest.json', '/.vite/', '/.env', '/%2evite/manifest.json', '/assets/.hidden', '/.well-known/x']) {
      const res = await app.request(path)
      expect(res.status, path).toBe(404)
      const text = await res.text()
      expect(text, path).not.toContain('id="root"')
      expect(text, path).not.toContain('src/main.tsx')
    }
  })

  it('does not leave the client directory', async () => {
    const app = site()
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt']) {
      const res = await app.request(path)
      expect(await res.text()).not.toContain('top secret')
    }
  })
})
