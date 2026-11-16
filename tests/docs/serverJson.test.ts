import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import pkg from '../../package.json'
import server from '../../server.json'

// server.json is Monido's card in the official MCP Registry, published by release.yml on every vX.Y.Z tag
it('the MCP Registry card names this repository, the shipped version and the /mcp route', () => {
  const slug = pkg.repository.url.match(/github\.com\/([^/]+)\/([^/.]+)/)!
  expect(server.name).toBe(`io.github.${slug[1]}/${slug[2]}`)
  expect(server.repository.url).toBe(`https://github.com/${slug[1]}/${slug[2]}`)
  expect(server.version).toBe(pkg.version)
  expect(server.description.length).toBeLessThanOrEqual(100)
  expect(server.remotes).toEqual([expect.objectContaining({ type: 'streamable-http', url: 'https://{host}/mcp' })])
  expect(readFileSync('src/modules/advisor/server.ts', 'utf8')).toContain("app.all('/mcp'")
})
