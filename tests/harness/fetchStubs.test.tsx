import { jsonResponse, stubApi } from '../helpers/http'
import { stubSnapshotFetch } from '../helpers/render'

const body = async (r: Response) => (await r.json()) as unknown

describe('stubApi', () => {
  it('answers a table by its rows and columns, the settings it keeps, anything else empty', async () => {
    stubApi({ assets: [{ rowid: 1, name: 'Cash' }] })
    expect(await body(await fetch('/api/admin/assets'))).toEqual({ rows: [{ rowid: 1, name: 'Cash' }], columns: ['name'] })
    await fetch('/api/settings', { method: 'PUT', body: JSON.stringify({ currency: 'EUR' }) })
    expect(await body(await fetch('/api/settings'))).toEqual({ language: 'en-US', currency: 'EUR', trackFlows: true })
    expect(await body(await fetch('/api/admin/goals'))).toEqual({ rows: [], columns: [] })
  })

  it('an answer is looked up by METHOD url, then by url, then by METHOD *', async () => {
    stubApi({}, {
      answer: {
        'PUT /api/wipe': () => jsonResponse('method and url'),
        '/api/wipe': () => jsonResponse('url'),
        'POST *': () => jsonResponse('every POST'),
      },
    })
    expect(await body(await fetch('/api/wipe', { method: 'PUT' }))).toBe('method and url')
    expect(await body(await fetch('/api/wipe', { method: 'POST' }))).toBe('url')
    expect(await body(await fetch('/api/admin/assets', { method: 'POST' }))).toBe('every POST')
    // no key: stubApi's own answer
    expect(await body(await fetch('/api/admin/assets'))).toEqual({ rows: [], columns: [] })
  })

  it('next is stubApi\'s own answer under the first map', async () => {
    stubApi({ assets: [{ rowid: 1, name: 'Cash' }] }, {
      answer: { 'GET /api/admin/assets': async (_, next) => jsonResponse({ wrapped: await body(await next()) }) },
    })
    expect(await body(await fetch('/api/admin/assets'))).toEqual({ wrapped: { rows: [{ rowid: 1, name: 'Cash' }], columns: ['name'] } })
  })

  it('.answer lays a map over the ones set, mid-test too: the newest answers, its next is the map below', async () => {
    const fetchMock = stubApi({}, { answer: { 'GET /api/auth': () => jsonResponse('first') } })
    expect(await body(await fetch('/api/auth'))).toBe('first')
    expect(fetchMock.answer({ 'GET /api/auth': async (_, next) => jsonResponse(['second', await body(await next())]) })).toBe(fetchMock)
    expect(await body(await fetch('/api/auth'))).toEqual(['second', 'first'])
    // a map without the request's key leaves it to the maps below
    fetchMock.answer({ 'GET /api/other': () => jsonResponse('other') })
    expect(await body(await fetch('/api/auth'))).toEqual(['second', 'first'])
  })

  it('the mock is the global fetch and records every request', async () => {
    const fetchMock = stubApi()
    await fetch('/api/other')
    expect(globalThis.fetch).toBe(fetchMock)
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual(['/api/other'])
  })
})

describe('stubSnapshotFetch', () => {
  it('leaves every request pending: it neither answers nor fails', async () => {
    stubSnapshotFetch()
    let settled = false
    void fetch('/api/snapshot').then(() => { settled = true }, () => { settled = true })
    // one macrotask turn: by then every microtask of an answer already given (even an error) has run
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settled).toBe(false)
  })
})
