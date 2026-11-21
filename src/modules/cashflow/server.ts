// The server side of the Cash flow module: /api/spending* (the only write path of the spending tables).
import { errorJson, guard, InputError, readJson, requireRight } from '../../server/http'
import type { ServerModule } from '../server'
import { addCategory, clearManual, deleteCategory, deleteSourceMonth, getSpending, isObject, buildMoveAccountLines, saveAccountLines, saveManual, saveSourceMonth, updateCategory } from './spending'

const BASE = '/api/spending'
const CATEGORY = new RegExp(`^${BASE}/categories/([^/]+)$`)
const MONTH_SOURCE = new RegExp(`^${BASE}/months/([^/]+)/([^/]+)$`)
/** An account's lines of a month: the account is in the body, since its member may be empty */
const MONTH_ACCOUNT = new RegExp(`^${BASE}/months/([^/]+)/account$`)

/** A path segment as text; a broken percent escape is an input error with the given code. */
function decode(segment: string, code: string): string {
  try { return decodeURIComponent(segment) } catch { throw new InputError(code) }
}

/** The id in the path; anything but digits is no category. */
function categoryIdOf(segment: string): number {
  if (!/^\d{1,15}$/.test(segment)) throw new InputError('unknown_category')
  return Number(segment)
}

export const cashflowServer: ServerModule = {
  key: 'cashflow',
  planRenameAccount: ({ db, actor }, from, to) => buildMoveAccountLines(db, actor, from, to),
  async api(request, { db, url, actor }) {
    const path = url.pathname
    const category = path.match(CATEGORY)
    const monthAccount = path.match(MONTH_ACCOUNT)
    // a free source named "account" is still reachable by DELETE; PUT of that path is the account's lines
    const monthSource = path.match(MONTH_SOURCE)
    if (path !== BASE && path !== `${BASE}/categories` && path !== `${BASE}/manual` && !category && !monthSource) return null
    const method = request.method
    return guard(request, { tag: 'spending', conflict: 'category_exists' }, async () => {
      if (path === BASE && method === 'GET') return getSpending(db, new Date())
      const write = async <T>(run: () => Promise<T>) => {
        // the core does not know this module's paths, so it checks its own writes
        requireRight(actor, 'edit')
        return run()
      }
      if (path === `${BASE}/categories` && method === 'POST') return write(async () => addCategory(db, actor, await readJson(request)))
      if (category && method === 'PATCH') return write(async () => updateCategory(db, actor, categoryIdOf(category[1]), await readJson(request)))
      if (category && method === 'DELETE') return write(() => deleteCategory(db, actor, categoryIdOf(category[1])))
      if (monthAccount && method === 'PUT') {
        return write(async () => {
          const body = await readJson(request)
          const account = isObject(body) ? { bank: body.bank, member: body.member } : { bank: undefined, member: undefined }
          return saveAccountLines(db, actor, monthAccount[1], account, body, new Date())
        })
      }
      if (monthSource && method === 'PUT') {
        return write(async () => saveSourceMonth(db, actor, monthSource[1], decode(monthSource[2], 'invalid_source'), await readJson(request)))
      }
      if (monthSource && method === 'DELETE') {
        // the body (`base`) is optional on a delete
        return write(async () => deleteSourceMonth(db, actor, monthSource[1], decode(monthSource[2], 'invalid_source'), request.body ? await readJson(request) : undefined))
      }
      if (path === `${BASE}/manual` && method === 'PUT') return write(async () => saveManual(db, actor, await readJson(request)))
      if (path === `${BASE}/manual` && method === 'DELETE') return write(() => clearManual(db, actor))
      return errorJson('method_not_allowed', 405)
    })
  },
}
