import { expect, it, vi } from 'vitest'
import { errorType, logEvent } from '../../src/server/log'

it('writes each event as a single JSON line with the same resource in demo mode', () => {
  vi.stubEnv('APP_VERSION', 'v1.2.3')
  vi.stubEnv('AUTH_MODE', 'demo')
  const sink = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    logEvent('WARN', 'monido.test.warning', 'First\nsecond\u2028third', { 'monido.attempts': 3 })
    const [line] = sink.mock.calls[0] as [string]
    expect(line).not.toMatch(/[\r\n\u2028]/)
    expect(JSON.parse(line)).toEqual({
      timestamp: expect.stringMatching(/Z$/), severity_text: 'WARN', severity_number: 13,
      event_name: 'monido.test.warning', body: 'First\nsecond\u2028third',
      resource: { 'service.name': 'monido', 'service.version': 'v1.2.3' },
      attributes: { 'monido.attempts': 3 },
    })
  } finally { sink.mockRestore(); vi.unstubAllEnvs() }
})

it('classifies trusted codes without copying unknown error fields', () => {
  expect(errorType({ errcode: 13 })).toBe('SQLITE_FULL')
  expect(errorType({ code: 'telegram.bad_token' })).toBe('telegram.bad_token')
  expect(errorType({ code: 'private-token', name: 'private-name', message: 'private-body' })).toBe('unknown')
})
