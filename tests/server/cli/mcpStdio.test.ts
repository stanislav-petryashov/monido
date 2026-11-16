import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildFamily } from '../../../src/demo/family'
import { isoDate } from '../../../src/domain/dates'
import { ADVISOR_GUIDE } from '../../../src/modules/advisor/guide'
import { advisorMcpServer } from '../../../src/modules/advisor/mcp'
import { ADVISOR_TOOLS } from '../../../src/modules/advisor/tools/registry'
import { loadAuthRuntime } from '../../../src/server/authSettings'
import { nudgeFor, run, stdioContext } from '../../../src/server/cli/mcpStdio'
import { loadConfig } from '../../../src/server/config'
import { openDatabase } from '../../../src/server/db'
import { writeFamily } from '../../../src/server/demo/writeFamily'
import { initializeSchema } from '../../../src/server/schema'
import { withTempDirs } from '../../helpers/tmp'

const tempDir = withTempDirs('monido-mcp-')
const SPAWN = { timeout: 30_000 }
type Answer = { content: { type: 'text'; text: string }[]; isError?: boolean }

/** A data dir with the demo family (Ryan manages, Annika and Mila do not), closed before anything opens it again. */
function familyDir(extraSql = ''): string {
  const dir = tempDir()
  const db = openDatabase(join(dir, 'finance.sqlite'))
  initializeSchema(db, 'schema.sql')
  writeFamily(db.sqlite, buildFamily({ today: isoDate(new Date()) }))
  if (extraSql) db.sqlite.exec(extraSql)
  db.close()
  return dir
}

const clients: Client[] = []
afterEach(async () => { for (const c of clients.splice(0)) await c.close() })

/** The command spawned as Claude Desktop would, its stderr collected. */
async function spawn(dataDir: string, args: string[] = [], env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/server/cli/mcpStdio.ts', ...args],
    env: { PATH: process.env.PATH ?? '', DATA_DIR: dataDir, ...env },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(transport)
  clients.push(client)
  return { client, stderr: () => stderr }
}

/** run() with its log captured; the database is never left open. */
async function runWith(argv: string[], env: Record<string, string>) {
  const lines: string[] = []
  const code = await run(argv, { env, log: line => lines.push(line), stdin: closedStdin() })
  return { code, log: lines.join('\n') }
}
function closedStdin() {
  const s = new PassThrough()
  s.end()
  return s
}

describe('monido-mcp: starting', () => {
  it('refuses a missing database without --init', async () => {
    const dir = tempDir()
    const { code, log } = await runWith([], { DATA_DIR: join(dir, 'nowhere') })
    expect(code).toBe(1)
    expect(log).toContain(`No database at ${join(dir, 'nowhere', 'finance.sqlite')}; check DATA_DIR`)
    expect(existsSync(join(dir, 'nowhere'))).toBe(false)
  })

  it('refuses the demo', async () => {
    const { code, log } = await runWith([], { DATA_DIR: tempDir(), AUTH_MODE: 'demo' })
    expect(code).toBe(1)
    expect(log).toContain('AUTH_MODE=demo')
  })

  it('refuses a database with another schema', async () => {
    const dir = familyDir('PRAGMA user_version = 2')
    const { code, log } = await runWith([], { DATA_DIR: dir })
    expect(code).toBe(1)
    expect(log).toContain('newer')
  })

  it('names the members when --member is unknown or a choice is needed', async () => {
    const unknown = await runWith(['--member', 'Nobody'], { DATA_DIR: familyDir() })
    expect(unknown.code).toBe(1)
    expect(unknown.log).toMatch(/Unknown member "Nobody"\. Members: .*Ryan/)
    const two = await runWith([], { DATA_DIR: familyDir("UPDATE users SET can_manage = 1 WHERE member = 'Annika'") })
    expect(two.code).toBe(1)
    expect(two.log).toMatch(/Choose a member with --member: .*Annika.*Ryan|Choose a member with --member: .*Ryan.*Annika/)
  })
})

describe('monido-mcp: serving', () => {
  it('creates an empty database with --init and lists every advisor tool', SPAWN, async () => {
    const dir = join(tempDir(), 'fresh')
    const { client } = await spawn(dir, ['--init'])
    expect(client.getInstructions()).toBe(ADVISOR_GUIDE)
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(ADVISOR_TOOLS.map(t => t.name))
    expect((await client.listPrompts()).prompts).toHaveLength(1)
    const overview = await client.callTool({ name: 'get_family_overview', arguments: {} }) as Answer
    expect(overview.isError).toBeUndefined()
    expect(existsSync(join(dir, 'finance.sqlite'))).toBe(true)
  })

  it('acts as the chosen member and journals as mcp; stdout stays JSON-RPC', SPAWN, async () => {
    const dir = familyDir()
    const { client, stderr } = await spawn(dir, ['--member', 'Ryan'])
    for (let i = 0; i < 2; i++) await client.callTool({ name: 'get_family_overview', arguments: {} })
    const added = await client.callTool({ name: 'add_spending_category', arguments: { name: 'Gym', kind: 'optional' } }) as Answer
    expect(added.isError).toBeUndefined()
    await client.close()
    const db = openDatabase(join(dir, 'finance.sqlite'))
    try {
      expect(db.sqlite.prepare('SELECT actor, source FROM change_log ORDER BY id DESC LIMIT 1').get()).toEqual({ actor: 'Ryan', source: 'mcp' })
    } finally { db.close() }
    // the sign-in notice went to stderr, once (stdout itself is checked by the piped session below)
    expect(stderr().match(/^\[auth\] /gm)).toHaveLength(1)
  })
})

describe('stdioContext', () => {
  it('reads rights per call and ends a deleted member\'s access', async () => {
    const dir = familyDir()
    const config = loadConfig({ DATA_DIR: dir })
    const db = openDatabase(join(dir, 'finance.sqlite'))
    try {
      const auth = await loadAuthRuntime(db, config, { log: () => {} })
      expect((await stdioContext(db, auth, 'Ryan', config)).actor).toMatchObject({ name: 'Ryan', source: 'mcp', rights: { edit: true } })
      db.sqlite.exec("UPDATE users SET can_edit = 0 WHERE member = 'Ryan'")
      const ctx = await stdioContext(db, auth, 'Ryan', config)
      expect(ctx.actor.rights.edit).toBe(false)
      expect(ctx).toMatchObject({ download: false, env: {} })

      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
      await advisorMcpServer(() => stdioContext(db, auth, 'Ryan', config), 'test').connect(serverSide)
      const client = new Client({ name: 'test', version: '0' })
      await client.connect(clientSide)
      clients.push(client)
      db.sqlite.exec("DELETE FROM users WHERE member = 'Ryan'")
      const gone = await client.callTool({ name: 'get_family_overview', arguments: {} }) as Answer
      expect(gone.isError).toBe(true)
      expect(JSON.parse(gone.content[0].text)).toEqual({ error: { code: 'unauthorized' } })
    } finally { db.close() }
  })

  it('acts as the family only while there are no users', async () => {
    const dir = tempDir()
    const config = loadConfig({ DATA_DIR: dir })
    const db = openDatabase(join(dir, 'finance.sqlite'))
    try {
      initializeSchema(db, 'schema.sql')
      const auth = await loadAuthRuntime(db, config, { log: () => {} })
      expect((await stdioContext(db, auth, null, config)).actor).toEqual({ name: 'family', source: 'mcp', rights: { edit: true, vote: false, manage: false }, userId: null })
      db.sqlite.exec("INSERT INTO users (member, created_at, updated_at) VALUES ('Ryan', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')")
      await expect(stdioContext(db, auth, null, config)).rejects.toMatchObject({ code: 'unauthorized' })
    } finally { db.close() }
  })
})

describe('nudgeFor', () => {
  it('signals the server only inside the image and only after a proposal write', () => {
    const kill = vi.fn()
    nudgeFor({}, kill)('propose_to_family')
    expect(kill).not.toHaveBeenCalled()

    const inImage = nudgeFor({ MONIDO_NUDGE_PID: '1' }, kill, 42)
    inImage('add_spending_category')
    expect(kill).not.toHaveBeenCalled()
    inImage('propose_to_family')
    expect(kill).toHaveBeenCalledExactlyOnceWith(1, 'SIGHUP')

    // under `docker run … monido-mcp` the command is pid 1 itself
    kill.mockClear()
    nudgeFor({ MONIDO_NUDGE_PID: '1' }, kill, 1)('withdraw_proposal')
    expect(kill).not.toHaveBeenCalled()
  })

  it('never fails the tool when the signal cannot be sent', () => {
    const kill = vi.fn(() => { throw new Error('ESRCH') })
    expect(() => nudgeFor({ MONIDO_NUDGE_PID: '1' }, kill, 42)('revise_proposal')).not.toThrow()
  })
})

describe('monido-mcp: a piped session', () => {
  const line = (message: object) => `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`
  const INIT = { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pipe', version: '0' } } }

  /** run() on a family database with the given stdin chunks; stdin ends at once after them, as a pipe does. */
  async function piped(chunks: string[]) {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let out = ''
    stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
    const done = run(['--member', 'Ryan'], { env: { DATA_DIR: familyDir() }, stdin, stdout, log: () => {} })
    for (const chunk of chunks) stdin.write(chunk)
    stdin.end()
    const code = await done
    return { code, messages: out.split('\n').filter(Boolean).map(l => JSON.parse(l) as { jsonrpc: string; id?: number }) }
  }

  it('answers every request written before stdin ends, writes only JSON-RPC and exits 0', async () => {
    const { code, messages } = await piped([
      line(INIT), line({ method: 'notifications/initialized' }),
      line({ id: 2, method: 'tools/list' }), line({ id: 3, method: 'tools/call', params: { name: 'get_family_overview', arguments: {} } }),
    ])
    expect(code).toBe(0)
    expect(messages.every(m => m.jsonrpc === '2.0')).toBe(true)
    expect(messages.map(m => m.id).sort()).toEqual([1, 2, 3])
  })

  it('does not wait for a request the client cancelled', { timeout: 10_000 }, async () => {
    const { code, messages } = await piped([
      line(INIT) + line({ method: 'notifications/initialized' })
        + line({ id: 2, method: 'tools/call', params: { name: 'get_family_overview', arguments: {} } })
        + line({ method: 'notifications/cancelled', params: { requestId: 2, reason: 'user' } }),
    ])
    expect(code).toBe(0)
    expect(messages.map(m => m.id)).toContain(1)
  })
})
