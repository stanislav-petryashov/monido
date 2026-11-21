// The app under test for the end-to-end tests (playwright.config.ts starts it): the built server (dist/, `npm run build`
// first) on a fresh temporary DATA_DIR, removed when the server stops. `--demo` starts the demo server (AUTH_MODE=demo),
// which builds its own families; otherwise the database gets the English demo family through the seed script and no
// password, so the first-run window is open.
// Usage: node --import tsx tests/e2e/server.ts <port> [--demo]
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = process.argv[2]
if (!port) throw new Error('Usage: tests/e2e/server.ts <port> [--demo]')
const demo = process.argv.includes('--demo')
const dataDir = mkdtempSync(join(tmpdir(), 'monido-e2e-'))
const env = { PATH: process.env.PATH, DATA_DIR: dataDir, PORT: port, HOST: '127.0.0.1', UPDATE_CHECK: 'off', ...(demo ? { AUTH_MODE: 'demo' } : {}) }

if (!demo) {
  // the seed script refuses a missing database file; an empty one gets the schema from it
  writeFileSync(join(dataDir, 'finance.sqlite'), '')
  const seed = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts', '--reset-demo'], { env, stdio: 'inherit' })
  if (seed.status !== 0) throw new Error('The demo seed failed')
}

const server = spawn(process.execPath, ['dist/server/main.js'], { env, stdio: 'inherit' })
server.on('exit', code => {
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal))
