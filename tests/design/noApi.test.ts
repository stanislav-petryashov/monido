import { blockApi } from '../../design/noApi'

// The catalog draws real panels whose buttons write (Available money's Confirm): it must never reach the dev server
describe('blockApi', () => {
  it('answers every /api request with a refusal and passes the rest through', async () => {
    const real = vi.fn(async () => new Response('ok'))
    const fetch = blockApi(real)
    const write = await fetch('/api/admin/availability', { method: 'POST', body: '{}' })
    expect(write.status).toBe(503)
    expect((await fetch(new URL('http://localhost:5173/api/snapshot'))).status).toBe(503)
    expect(real).not.toHaveBeenCalled()
    await fetch('/design/main.tsx')
    expect(real).toHaveBeenCalledTimes(1)
  })
})
