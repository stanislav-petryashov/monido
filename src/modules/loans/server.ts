import { errorJson, guard, readJson } from '../../server/http'
import type { ServerModule } from '../server'
import { deleteLoan, updateLoan } from './operations'

export const loansServer: ServerModule = {
  key: 'loans',
  async api(request, { db, url, actor }) {
    const match = url.pathname.match(/^\/api\/loans\/(\d{1,15})$/)
    if (!match) return null
    const method = request.method
    return guard(request, { tag: 'loans', conflict: 'data_conflict' }, async () => {
      const rowid = Number(match[1])
      if (method === 'PUT') return updateLoan(db, actor, rowid, await readJson(request))
      if (method === 'DELETE') return deleteLoan(db, actor, rowid)
      return errorJson('method_not_allowed', 405)
    })
  },
}
