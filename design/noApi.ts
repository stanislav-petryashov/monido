/**
 * The catalog never talks to the dev server: its panels have buttons that write (Available money's Confirm), and a
 * signed-in developer would change real dev data. Every /api request is refused with a 503; the rest passes through.
 */
export function blockApi(real: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, globalThis.location?.href ?? 'http://localhost/')
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') return Promise.resolve(new Response('The design catalog does not reach the API.', { status: 503 }))
    return real(input, init)
  }
}
