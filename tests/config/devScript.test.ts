import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../..')

describe('npm run dev data directory', () => {
  it('loads dev.env after .env, so a DATA_DIR in .env never reaches the dev server', () => {
    const script: string = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['dev:server']
    const envFile = script.indexOf('--env-file-if-exists=.env ')
    const devEnv = script.indexOf('--env-file=dev.env ')
    expect(envFile).toBeGreaterThanOrEqual(0)
    expect(devEnv).toBeGreaterThan(envFile)
    expect(script).not.toMatch(/\$\{|DATA_DIR=/)
  })

  it('dev.env keeps development data local and disables login only on loopback', () => {
    const lines = readFileSync(join(ROOT, 'dev.env'), 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))
    expect(lines).toEqual(['DATA_DIR=data-dev', 'HOST=127.0.0.1'])
  })
})
