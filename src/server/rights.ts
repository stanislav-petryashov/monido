// Which right a request needs; app.ts checks it for every route after sign-in. Modules check their own writes.
import type { Right } from '../domain/api'

/** The right the core demands for the route, null — none (every read, /api/auth*). */
export function routeRight(method: string, path: string): Right | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null
  if (/^\/api\/(admin|month-close|accounts|loans|real-estate|availability)(\/|$)/.test(path)) return 'edit'
  if (/^\/api\/(settings|setup|users|wipe|auth-settings|demo-data)(\/|$)/.test(path) || path === '/api/backup/restore') return 'manage'
  return null
}
