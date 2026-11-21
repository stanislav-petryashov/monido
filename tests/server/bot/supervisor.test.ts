import { describe, expect, it, vi } from 'vitest'
import type { BotHandle, startBotReader } from '../../../src/server/bot/reader'
import { startBotSupervisor } from '../../../src/server/bot/supervisor'
import { createLoginAttempts } from '../../../src/server/loginAttempts'
import { fakeAuthRuntime } from '../../helpers/auth'
import { createTestDb, testConfig } from '../../helpers/db'

/** A reader factory that records `start:<token>` / `stop:<token>`; stop takes a tick, so a missing await shows in the order. */
function fakeReaders() {
  const calls: string[] = []
  const startReader = vi.fn((o: Parameters<typeof startBotReader>[0]): BotHandle => {
    calls.push(`start:${o.token}`)
    return {
      username: () => `bot_${o.token}`,
      status: () => ({ configured: true, username: `bot_${o.token}`, problem: null }),
      stop: async () => { await Promise.resolve(); calls.push(`stop:${o.token}`) },
    }
  }) as unknown as typeof startBotReader
  return { calls, startReader }
}

const flush = () => new Promise<void>(resolve => { setTimeout(resolve, 0) })

function setup(botToken: string | null) {
  const db = createTestDb()
  const auth = fakeAuthRuntime({ botToken })
  const { calls, startReader } = fakeReaders()
  const bot = startBotSupervisor({ auth, db, config: testConfig(), logins: createLoginAttempts(), startReader })
  return { auth, bot, calls }
}

describe('startBotSupervisor', () => {
  it('starts a reader when the runtime has a token, none without', () => {
    expect(setup('a').calls).toEqual(['start:a'])
    expect(setup(null).calls).toEqual([])
  })

  it('restarts on a token change: the old reader is stopped first', async () => {
    const { auth, bot, calls } = setup('a')
    auth.set({ botToken: 'b' })
    await flush()
    expect(calls).toEqual(['start:a', 'stop:a', 'start:b'])
    await bot.stop()
  })

  it('ignores a change that keeps the same token', async () => {
    const { auth, bot, calls } = setup('a')
    auth.set({ mode: 'telegram' })
    await flush()
    expect(calls).toEqual(['start:a'])
    await bot.stop()
  })

  it('stops the reader when the token is cleared; status() says not configured', async () => {
    const { auth, bot, calls } = setup('a')
    auth.set({ botToken: null })
    await flush()
    expect(calls).toEqual(['start:a', 'stop:a'])
    expect(bot.status()).toEqual({ configured: false, username: null, problem: null })
    expect(bot.username()).toBeNull()
    auth.set({ botToken: 'c' })
    await flush()
    expect(calls).toEqual(['start:a', 'stop:a', 'start:c'])
    await bot.stop()
  })

  it('passes username() and status() through from the current reader', async () => {
    const { auth, bot } = setup('a')
    expect(bot.username()).toBe('bot_a')
    expect(bot.status()).toEqual({ configured: true, username: 'bot_a', problem: null })
    auth.set({ botToken: 'b' })
    await flush()
    expect(bot.username()).toBe('bot_b')
    await bot.stop()
  })

  it('stop() stops the reader and later changes start nothing', async () => {
    const { auth, bot, calls } = setup('a')
    await bot.stop()
    auth.set({ botToken: 'b' })
    await flush()
    expect(calls).toEqual(['start:a', 'stop:a'])
  })

  it('a reader that fails to start is logged, not thrown into the change, and the next change recovers', async () => {
    const db = createTestDb()
    const auth = fakeAuthRuntime({ botToken: null })
    const calls: string[] = []
    const startReader = vi.fn((o: Parameters<typeof startBotReader>[0]): BotHandle => {
      if (o.token === 'bad') throw new Error('boom')
      calls.push(`start:${o.token}`)
      return { username: () => null, status: () => ({ configured: true, username: null, problem: null }), stop: async () => {} }
    }) as unknown as typeof startBotReader
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const bot = startBotSupervisor({ auth, db, config: testConfig(), logins: createLoginAttempts(), startReader })
    expect(() => auth.set({ botToken: 'bad' })).not.toThrow()
    await flush()
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ event_name: 'monido.telegram.restart_failed', attributes: { 'error.type': 'Error' } })
    auth.set({ botToken: 'good' })
    await flush()
    expect(calls).toEqual(['start:good'])
    log.mockRestore()
    await bot.stop()
  })
})
