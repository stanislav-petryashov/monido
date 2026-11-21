const severity = { INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 } as const

export function logEvent(
  level: keyof typeof severity, name: `monido.${string}`, body: string,
  attributes: Record<string, string | number | boolean> = {},
): void {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(), severity_text: level, severity_number: severity[level],
    event_name: name, body,
    resource: { 'service.name': 'monido', 'service.version': process.env.APP_VERSION?.trim() || 'dev' },
    attributes,
  }).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`))
}

const sqliteCodes: Record<number, string> = {
  1: 'SQLITE_ERROR', 5: 'SQLITE_BUSY', 6: 'SQLITE_LOCKED', 8: 'SQLITE_READONLY', 10: 'SQLITE_IOERR',
  11: 'SQLITE_CORRUPT', 13: 'SQLITE_FULL', 14: 'SQLITE_CANTOPEN', 19: 'SQLITE_CONSTRAINT', 26: 'SQLITE_NOTADB',
}

const operationalCodes = new Set([
  'EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOSPC', 'EADDRINUSE', 'ETIMEDOUT', 'ECONNREFUSED',
  'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_SQLITE_ERROR',
  'telegram.bad_token', 'telegram.external', 'telegram.other_reader', 'telegram.status',
  'telegram.unavailable', 'telegram.webhook', 'reminders.send_failed', 'reminders.unreachable',
])

// Error messages, names and third-party codes may contain credentials or user data.
export function errorType(err: unknown): string {
  if (!err || typeof err !== 'object') return 'unknown'
  if ('errcode' in err && typeof err.errcode === 'number') return sqliteCodes[err.errcode & 0xff] ?? 'SQLITE_ERROR'
  if ('code' in err && typeof err.code === 'string' && operationalCodes.has(err.code)) return err.code
  if (err instanceof TypeError) return 'TypeError'
  if (err instanceof RangeError) return 'RangeError'
  if (err instanceof SyntaxError) return 'SyntaxError'
  return err instanceof Error ? 'Error' : 'unknown'
}
