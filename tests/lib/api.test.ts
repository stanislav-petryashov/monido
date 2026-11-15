import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, apiSend, downloadFile } from '../../src/lib/api'
import { resetAuth, setAuth, useAuth } from '../../src/lib/authState'
import { renderHook } from '@testing-library/react'
import { ru, withLanguage } from '../helpers/i18n'
import { jsonResponse } from '../helpers/http'
import type { FamilySettings, Row } from '../../src/domain/api'
import { stubDownload } from '../helpers/download'

describe('apiFetch', () => {
  it('returns the JSON body of a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })))
    expect(await apiFetch('/api/settings')).toEqual({ ok: true })
  })

  it('still shows a plain-text error body as received', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'legacy text' }, 409)))
    await expect(apiFetch('/api/month-close')).rejects.toThrow('legacy text')
  })

  it('falls back to the HTTP status when the error body is not JSON (an HTML 502 from a proxy)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } })))
    await expect(apiFetch('/api/snapshot')).rejects.toThrow('Request failed (HTTP 502)')
  })

  it('does not pass off a non-JSON success (an HTML page) as data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } })))
    await expect(apiFetch('/api/snapshot')).rejects.toThrow('Request failed (HTTP 200)')
  })
})

describe('a network failure', () => {
  it('reads as the server being unreachable, not the browser\'s raw text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(apiFetch('/api/snapshot')).rejects.toMatchObject({ status: 0, code: 'network', message: 'The server is unreachable' })
    await expect(downloadFile('/api/backup')).rejects.toMatchObject({ code: 'network' })
  })

  it('leaves a cancelled request an AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError') }))
    await expect(apiFetch('/api/snapshot')).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('401', () => {
  afterEach(() => resetAuth())
  const signedIn = () => setAuth({ mode: 'password', authenticated: true, me: { name: null, rights: { edit: true, vote: true, manage: true } } })

  it('wrong_current_password is an ordinary error: the session stays', async () => {
    signedIn()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'wrong_current_password' } }, 401)))
    await expect(apiSend('/api/auth-settings/password', 'POST', { current: 'x', password: 'y' }))
      .rejects.toMatchObject({ code: 'wrong_current_password', status: 401, message: 'The current password is wrong' })
    expect(renderHook(() => useAuth()).result.current.authenticated).toBe(true)
  })

  it('any other 401 ends the session', async () => {
    signedIn()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'unauthorized' } }, 401)))
    await expect(apiFetch('/api/users')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(renderHook(() => useAuth()).result.current.authenticated).toBe(false)
  })
})

describe('typed answers', () => {
  it('apiFetch<T> hands the body over', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ language: 'en-US', currency: 'USD', trackFlows: false })))
    const answer = await apiFetch<FamilySettings>('/api/settings')
    expect(answer.trackFlows).toBe(false)
  })

  it('apiSend<T> reads the answer of a write and sends the body as JSON', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ rowid: 7, name: 'Cash' }))
    vi.stubGlobal('fetch', fetchMock)
    const saved = await apiSend<Row>('/api/admin/assets', 'POST', { name: 'Cash' })
    expect(saved).toEqual({ rowid: 7, name: 'Cash' })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/assets', expect.objectContaining({ method: 'POST', body: '{"name":"Cash"}' }))
  })

  it('keeps the ApiError for a typed request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'row_not_found' } }, 404)))
    await expect(apiSend<Row>('/api/admin/assets/9', 'PUT', {})).rejects.toBeInstanceOf(ApiError)
  })
})

describe('error codes', () => {
  const failWith = (body: unknown, status: number) => vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body, status)))
  const caught = async () => apiFetch('/api/x').then(() => { throw new Error('expected a rejection') }, (e: unknown) => e as ApiError)

  it('translates a code into the UI language and keeps code, params and status', async () => {
    failWith({ error: { code: 'wrong_password' } }, 400)
    const e = await caught()
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ message: 'Wrong password', code: 'wrong_password', status: 400 })
    await withLanguage('ru-RU', async () => {
      expect((await caught()).message).toBe(ru('errors.wrong_password'))
    })
  })

  it('fills the params into the text', async () => {
    failWith({ error: { code: 'unknown_column', params: { column: 'nope' } } }, 400)
    expect(await caught()).toMatchObject({ message: 'Unknown column: nope', params: { column: 'nope' } })
  })

  it('does not take a group of keys for a code: the text is the plain HTTP one', async () => {
    // `errors.reminders` exists in the locale, but as a group of module codes, not as a message
    failWith({ error: { code: 'reminders' } }, 500)
    expect(await caught()).toMatchObject({ message: 'Request failed (HTTP 500)', code: 'reminders' })
  })

  it('names a module code by its prefixed key', async () => {
    failWith({ error: { code: 'reminders.no_chat' } }, 409)
    expect((await caught()).message).toBe('Link a chat first')
  })

  it('lists the problems of a month that cannot be closed', async () => {
    const problems = [
      { name: '', member: '', problem: { code: 'no_accounts' } },
      { name: 'Quillmark Bank', member: 'Robin', problem: { code: 'missing', fields: ['balance', 'expense'] } },
      { name: 'Cash jar', member: '', problem: { code: 'no_currency' } },
    ]
    failWith({ error: { code: 'month_has_problems', params: { problems } } }, 422)
    expect((await caught()).message).toBe('The month cannot be closed: no accounts at all; “Quillmark Bank” (Robin): not filled in: balance, expenses; “Cash jar”: no currency')
    await withLanguage('ru-RU', async () => {
      const line = (p: (typeof problems)[number]) => ru(`monthClose.problem.${p.problem.code}`, { fields: (p.problem.fields ?? []).map(f => ru(`monthClose.field.${f}`)).join(', ') })
      const list = [line(problems[0]), ru('monthClose.problemAccountMember', { name: 'Quillmark Bank', member: 'Robin', problem: line(problems[1]) }), ru('monthClose.problemAccount', { name: 'Cash jar', problem: line(problems[2]) })].join('; ')
      expect((await caught()).message).toBe(ru('errors.month_has_problems', { problems }))
      expect((await caught()).message).toContain(list)
    })
  })

  it('an unknown code reads as the HTTP status, not as the code or an object', async () => {
    failWith({ error: { code: 'nope' } }, 409)
    const e = await caught()
    expect(e.message).toBe('Request failed (HTTP 409)')
    expect(e.code).toBe('nope')
    expect(e.message).not.toContain('[object')
  })

  it('a 401 is an ApiError with the code unauthorized', async () => {
    failWith({ error: { code: 'unauthorized' } }, 401)
    expect(await caught()).toMatchObject({ code: 'unauthorized', status: 401, message: 'Not signed in' })
  })

  it('a body that is not JSON reads as its HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })))
    const e = await caught()
    expect(e).toMatchObject({ code: null, status: 502 })
    expect(e.message).toContain('502')
  })
})

describe('apiSend', () => {
  it('sends a JSON body with the content-type header', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await apiSend('/api/admin/goals', 'POST', { name: 'Cabin' })).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/goals')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.body).toBe('{"name":"Cabin"}')
  })

  it('sends only the method when there is no body', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await apiSend('/api/admin/goals/7', 'DELETE')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init).toEqual({ method: 'DELETE' })
  })
})

describe('downloadFile', () => {
  afterEach(() => { resetAuth() })

  it('saves the response under the name the server sends', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.sqlite3', 'Content-Disposition': 'attachment; filename="finance-2031-03-08.sqlite"' },
    })))
    const { createObjectURL, clicked } = stubDownload()

    await expect(downloadFile('/api/backup')).resolves.toBe('finance-2031-03-08.sqlite')
    expect(clicked).toEqual([{ href: 'blob:copy', download: 'finance-2031-03-08.sqlite' }])
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('reports the server error text and ends the session on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'backup_failed' } }, 500)))
    await expect(downloadFile('/api/backup')).rejects.toThrow('Unable to export the database')

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'unauthorized' } }, 401)))
    const { result } = renderHook(() => useAuth())
    await expect(downloadFile('/api/backup')).rejects.toMatchObject({ code: 'unauthorized', message: 'Not signed in' })
    expect(result.current.authenticated).toBe(false)
  })
})
