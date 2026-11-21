import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import serverConfig from '../../vite.server.config'

const ROOT = join(__dirname, '../..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

describe('the image and the server build', () => {
  it('vite.server.config builds main.js, reset-password.js and mcp-stdio.js', () => {
    const rollup = serverConfig.build?.rollupOptions
    expect(rollup?.input).toEqual({ log: 'src/server/log.ts', main: 'src/server/main.ts', 'reset-password': 'src/server/cli/resetPassword.ts', 'mcp-stdio': 'src/server/cli/mcpStdio.ts' })
    expect(rollup?.output).toMatchObject({ entryFileNames: '[name].js' })
  })

  it('package.json has the reset-password script for the dev database', () => {
    expect(JSON.parse(read('package.json')).scripts['reset-password']).toBe(
      'node --env-file-if-exists=.env --env-file=dev.env --import tsx src/server/cli/resetPassword.ts',
    )
  })

  it('the image installs monido-mcp, which runs the built command and may signal the server', () => {
    expect(read('.dockerignore')).toContain('!deploy/docker/monido-mcp')
    expect(read('Dockerfile')).toContain('COPY --chmod=755 deploy/docker/monido-mcp /usr/local/bin/monido-mcp')
    expect(read('deploy/docker/monido-mcp')).toContain('MONIDO_NUDGE_PID=1 exec as-server node /app/dist/server/mcp-stdio.js "$@"')
    expect(JSON.parse(read('package.json')).scripts['mcp:stdio']).toBe(
      'node --env-file-if-exists=.env --env-file=dev.env --import tsx src/server/cli/mcpStdio.ts',
    )
  })

  it('starts as node by default; a root start drops to PUID:PGID after fixing the data folder\'s owner, one level deep', () => {
    const dockerfile = read('Dockerfile')
    expect(dockerfile).toContain('RUN apk add --no-cache su-exec')
    expect(dockerfile).toContain('COPY --chmod=755 deploy/docker/entrypoint /usr/local/bin/monido-entrypoint')
    expect(dockerfile).toContain('COPY --chmod=755 deploy/docker/as-server /usr/local/bin/as-server')
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/monido-entrypoint"]')
    // the default user is unchanged: the shipped compose drops every capability, a root start would crash-loop there
    expect(dockerfile.indexOf('USER node')).toBeGreaterThan(dockerfile.indexOf('monido-entrypoint'))
    for (const file of ['entrypoint', 'as-server']) expect(read('.dockerignore')).toContain(`!deploy/docker/${file}`)
    const entrypoint = read('deploy/docker/entrypoint')
    expect(entrypoint).toContain('exec su-exec "$PUID:$PGID" "$@"')
    expect(entrypoint).toContain('-maxdepth 1')
    expect(entrypoint).not.toContain('chown -R')
    expect(read('deploy/docker/as-server')).toContain('/proc/1/status')
  })

  it('the commands run as the server\'s own user, never as root', () => {
    expect(read('deploy/docker/reset-password')).toContain('MONIDO_NUDGE_PID=1 exec as-server node /app/dist/server/reset-password.js "$@"')
  })
})
