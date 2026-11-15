import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import serverConfig from '../../vite.server.config'

const ROOT = join(__dirname, '../..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

describe('the image and the server build', () => {
  it('vite.server.config builds main.js and reset-password.js', () => {
    const rollup = serverConfig.build?.rollupOptions
    expect(rollup?.input).toEqual({ main: 'src/server/main.ts', 'reset-password': 'src/server/cli/resetPassword.ts' })
    expect(rollup?.output).toMatchObject({ entryFileNames: '[name].js' })
  })

  it('package.json has the reset-password script for the dev database', () => {
    expect(JSON.parse(read('package.json')).scripts['reset-password']).toBe(
      'node --env-file-if-exists=.env --env-file=dev.env --import tsx src/server/cli/resetPassword.ts',
    )
  })
})
