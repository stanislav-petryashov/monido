import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigError, loadConfig, moduleEnv, secureCookies, warnIfClientIpShared } from '../../src/server/config'
import { fakeAuthRuntime } from '../helpers/auth'

const LONG_SECRET = 'a'.repeat(32)

describe('loadConfig', () => {
  it('reads no AUTH_MODE as null (the mode is the app\'s) and listens on 0.0.0.0:8080', () => {
    const c = loadConfig({})
    expect(c).toMatchObject({ authMode: null, host: '0.0.0.0', port: 8080, appUrl: null, telegramBotToken: null, sessionSecret: null })
    expect(c.clientDir.endsWith('dist/client')).toBe(true)
  })

  it('defaults DATA_DIR to ./data-dev outside the server build, to the given default otherwise', () => {
    // the tests run the sources, where __SERVER_BUILD__ is not defined: as under tsx in npm run dev
    expect(loadConfig({}).dataDir).toBe(join(process.cwd(), 'data-dev'))
    expect(loadConfig({}, { defaultDataDir: 'data-dev' }).dataDir).toBe(join(process.cwd(), 'data-dev'))
    expect(loadConfig({}, { defaultDataDir: 'data' }).dataDir).toBe(join(process.cwd(), 'data'))
    expect(loadConfig({ DATA_DIR: '/srv/f' }, { defaultDataDir: 'data' }).dataDir).toBe('/srv/f')
    expect(loadConfig({ DATA_DIR: ' ' }, { defaultDataDir: 'data' }).dataDir).toBe(join(process.cwd(), 'data'))
  })

  it('loadConfig({}) leaves sign-in managed in the app', () => {
    expect(loadConfig({})).toMatchObject({ authMode: null, telegramBotToken: null })
    expect(loadConfig({ AUTH_MODE: ' ', APP_PASSWORD: '' })).toMatchObject({ authMode: null })
  })

  it.each(['password', 'telegram', 'basic'])('rejects AUTH_MODE=%s with web setup instructions', AUTH_MODE => {
    expect(() => loadConfig({ AUTH_MODE })).toThrow(/AUTH_MODE only accepts "none" or "demo".*Settings/)
  })

  it('no OIDC variables: no provider', () => {
    expect(loadConfig({}).oidc).toBeNull()
  })

  describe('the identity provider', () => {
    const base = { OIDC_ISSUER: 'https://idp.example/', OIDC_CLIENT_ID: 'monido', OIDC_CLIENT_SECRET: 's3cret', APP_URL: 'https://money.example' }

    it('a complete setup has no problem and a redirect URI on the origin of APP_URL', () => {
      expect(loadConfig(base).oidc).toEqual({
        issuer: 'https://idp.example/', clientId: 'monido', secret: 's3cret',
        redirectUri: 'https://money.example/api/auth/oidc/callback', problem: null,
      })
    })

    it('APP_URL with a sub-path and a trailing slash still gives the origin\'s callback', () => {
      expect(loadConfig({ ...base, APP_URL: 'https://host.example/monido/' }).oidc?.redirectUri).toBe('https://host.example/api/auth/oidc/callback')
    })

    it.each([
      [{ OIDC_ISSUER: '' }, 'issuer_missing'],
      [{ OIDC_ISSUER: 'not a url' }, 'issuer_invalid'],
      [{ OIDC_ISSUER: 'http://idp.example' }, 'issuer_not_https'],
      [{ OIDC_CLIENT_ID: '' }, 'client_id_missing'],
      [{ OIDC_CLIENT_SECRET: '' }, 'secret_missing'],
      [{ APP_URL: '' }, 'app_url_missing'],
      [{ APP_URL: 'http://money.example' }, 'app_url_not_https'],
    ])('a broken setup never throws: %o is %s', (change, problem) => {
      expect(loadConfig({ ...base, ...change }).oidc?.problem).toBe(problem)
    })

    it('an unreadable secret file is secret_unreadable, not a startup error', () => {
      const { OIDC_CLIENT_SECRET: _, ...rest } = base
      expect(loadConfig({ ...rest, OIDC_CLIENT_SECRET_FILE: '/nonexistent/secret' }).oidc).toMatchObject({ secret: null, problem: 'secret_unreadable' })
    })

    it('reads the secret from the file, trimmed; the variable wins over the file', () => {
      const file = join(mkdtempSync(join(tmpdir(), 'oidc-')), 'secret')
      writeFileSync(file, 'from-file\n')
      const { OIDC_CLIENT_SECRET: _, ...rest } = base
      expect(loadConfig({ ...rest, OIDC_CLIENT_SECRET_FILE: file }).oidc?.secret).toBe('from-file')
      expect(loadConfig({ ...base, OIDC_CLIENT_SECRET_FILE: file }).oidc?.secret).toBe('s3cret')
    })
  })

  it('accepts the explicit no-authentication override', () => {
    expect(loadConfig({ AUTH_MODE: 'none' }).authMode).toBe('none')
  })

  it('rejects a legacy password without exposing it', () => {
    expect(() => loadConfig({ APP_PASSWORD: 'old secret' })).toThrow(/APP_PASSWORD is no longer supported.*Remove it/)
    expect(() => loadConfig({ AUTH_MODE: 'demo', APP_PASSWORD: 'old secret' })).toThrow(ConfigError)
  })

  it('exposes the module env and the cookie flag', () => {
    const c = loadConfig({ APP_URL: 'https://f.example', TELEGRAM_BOT_TOKEN: 't', DATA_DIR: '/data', PORT: '9000', HOST: '127.0.0.1', SESSION_SECRET: LONG_SECRET })
    expect(moduleEnv(c, fakeAuthRuntime({ botToken: 't' }))).toEqual({ TELEGRAM_BOT_TOKEN: 't', APP_URL: 'https://f.example' })
    expect(secureCookies(c)).toBe(true)
    expect(secureCookies(loadConfig({}))).toBe(false)
    expect(c).toMatchObject({ dataDir: '/data', port: 9000, host: '127.0.0.1', sessionSecret: LONG_SECRET })
  })

  it('treats an empty or whitespace-only APP_PASSWORD as unset, not as a short password', () => {
    expect(loadConfig({ APP_PASSWORD: '          ' }).authMode).toBeNull()
    expect(loadConfig({ APP_PASSWORD: ' \t \n     ' }).authMode).toBeNull()
    expect(loadConfig({ APP_PASSWORD: '' }).authMode).toBeNull()
  })

  it('accepts only a decimal PORT from 0 to 65535', () => {
    for (const PORT of ['0x50', '1e3', '8080.0', '-1', '65536', '80 80']) {
      expect(() => loadConfig({ PORT }), PORT).toThrow(/PORT/)
    }
    expect(loadConfig({ PORT: '0' }).port).toBe(0)
    expect(loadConfig({ PORT: ' 8081 ' }).port).toBe(8081)
  })

  it('defaults HOST to 0.0.0.0 and SCHEMA_FILE to ./schema.sql', () => {
    const c = loadConfig({})
    expect(c.host).toBe('0.0.0.0')
    expect(c.schemaFile).toBe(join(process.cwd(), 'schema.sql'))
  })

  it('gives modules an empty env when no token or URL is set', () => {
    expect(moduleEnv(loadConfig({}), fakeAuthRuntime())).toEqual({})
  })

  it('marks cookies Secure for https only, ignoring the case of the scheme', () => {
    const at = (APP_URL: string) => secureCookies(loadConfig({ APP_URL }))
    expect(at('HTTPS://Finance.example')).toBe(true)
    expect(at('https://finance.example')).toBe(true)
    expect(at('http://finance.example')).toBe(false)
    expect(at('http://192.168.1.10:8080')).toBe(false)
  })

  it('refuses a SESSION_SECRET shorter than 32 characters, an empty one means "generate"', () => {
    expect(() => loadConfig({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET.*32/)
    expect(() => loadConfig({ SESSION_SECRET: 'a'.repeat(31) })).toThrow(ConfigError)
    expect(loadConfig({ SESSION_SECRET: '' }).sessionSecret).toBeNull()
  })
})

describe('demo mode', () => {
  it('needs no APP_PASSWORD and defaults DEMO_PASSWORD to demo-family', () => {
    const c = loadConfig({ AUTH_MODE: 'demo' })
    expect(c).toMatchObject({ authMode: 'demo', demoPassword: 'demo-family', demoInstallUrl: null })
    expect(loadConfig({ AUTH_MODE: 'demo', DEMO_PASSWORD: ' ' }).demoPassword).toBe('demo-family')
  })

  it('takes DEMO_PASSWORD of at least 8 characters, refuses a shorter one', () => {
    expect(loadConfig({ AUTH_MODE: 'demo', DEMO_PASSWORD: 'try-it-now' }).demoPassword).toBe('try-it-now')
    expect(() => loadConfig({ AUTH_MODE: 'demo', DEMO_PASSWORD: 'short' })).toThrow(ConfigError)
    expect(() => loadConfig({ AUTH_MODE: 'demo', DEMO_PASSWORD: 'short' })).toThrow(/DEMO_PASSWORD.*8/)
  })

  it('takes DEMO_INSTALL_URL as an http(s) address, refuses anything else', () => {
    const url = 'https://github.com/example/family-finance'
    expect(loadConfig({ AUTH_MODE: 'demo', DEMO_INSTALL_URL: ` ${url} ` }).demoInstallUrl).toBe(url)
    for (const DEMO_INSTALL_URL of ['javascript:alert(1)', 'not a url', 'ftp://example.com']) {
      expect(() => loadConfig({ AUTH_MODE: 'demo', DEMO_INSTALL_URL }), DEMO_INSTALL_URL).toThrow(/DEMO_INSTALL_URL/)
    }
  })

  it('ignores the demo variables outside demo mode', () => {
    const env = { DEMO_PASSWORD: 'short', DEMO_INSTALL_URL: 'javascript:alert(1)' }
    expect(loadConfig(env)).toMatchObject({ demoPassword: null, demoInstallUrl: null })
  })
})

describe('CLIENT_IP_HEADER', () => {
  it('is unset by default and when empty, kept as given otherwise', () => {
    expect(loadConfig({}).clientIpHeader).toBeUndefined()
    expect(loadConfig({ CLIENT_IP_HEADER: '  ' }).clientIpHeader).toBeUndefined()
    expect(loadConfig({ CLIENT_IP_HEADER: ' CF-Connecting-IP ' }).clientIpHeader).toBe('CF-Connecting-IP')
  })
})

describe('warnIfClientIpShared', () => {
  const warnings = (env: Record<string, string>) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnIfClientIpShared(loadConfig(env))
    const calls = warn.mock.calls.map(args => args.join(' '))
    warn.mockRestore()
    return calls
  }
  const TELEGRAM = { TELEGRAM_BOT_TOKEN: '1:t' }

  it('warns once when APP_URL is on https and CLIENT_IP_HEADER is unset, in password and telegram mode', () => {
    for (const env of [{ ...TELEGRAM, APP_URL: 'https://family.example.com' }, { APP_URL: 'HTTPS://family.example.com' }] as Record<string, string>[]) {
      const calls = warnings(env)
      expect(calls, env.APP_URL).toHaveLength(1)
      expect(calls[0]).toMatch(/^\[config\] /)
      expect(calls[0]).toMatch(/proxy or tunnel/)
      expect(calls[0]).toMatch(/one sign-in and token limit/)
      expect(calls[0]).toContain('CLIENT_IP_HEADER')
      expect(calls[0]).toContain('CF-Connecting-IP')
    }
  })

  it('warnIfClientIpShared warns with authMode null too (the app-managed modes)', () => {
    expect(warnings({ APP_URL: 'https://family.example.com' })).toHaveLength(1)
    expect(warnings({ AUTH_MODE: 'demo', APP_URL: 'https://family.example.com' })).toEqual([])
  })

  it('stays silent with CLIENT_IP_HEADER set, without APP_URL or on http', () => {
    expect(warnings({ ...TELEGRAM, APP_URL: 'https://family.example.com', CLIENT_IP_HEADER: 'CF-Connecting-IP' })).toEqual([])
    expect(warnings({ ...TELEGRAM })).toEqual([])
    expect(warnings({ ...TELEGRAM, APP_URL: 'http://192.168.1.10:8080' })).toEqual([])
  })
})

describe('loadConfig: version and update check', () => {
  const base = {}
  it('defaults to dev with the check on', () => {
    const c = loadConfig(base)
    expect(c.appVersion).toBe('dev')
    expect(c.updateCheck).toBe(true)
  })
  it('reads APP_VERSION and turns the check off with off, false or 0', () => {
    expect(loadConfig({ ...base, APP_VERSION: '0.10.0' }).appVersion).toBe('0.10.0')
    for (const v of ['off', 'false', '0', 'OFF']) expect(loadConfig({ ...base, UPDATE_CHECK: v }).updateCheck).toBe(false)
  })
  it('is off in demo', () => {
    expect(loadConfig({ AUTH_MODE: 'demo' }).updateCheck).toBe(false)
  })
})
