import { errorJson, guard, readJson } from '../../server/http'
import type { ServerModule } from '../server'
import { deleteProperty, updateProperty } from './operations'

export const realEstateServer: ServerModule = {
  key: 'real_estate',
  async api(request, { db, url, actor }) {
    const path = url.pathname
    if (path !== '/api/real-estate/update' && path !== '/api/real-estate/delete') return null
    const method = request.method
    return guard(request, { tag: 'real-estate', conflict: 'data_conflict' }, async () => {
      if (method !== 'POST') return errorJson('method_not_allowed', 405)
      const body = await readJson(request)
      return path === '/api/real-estate/update' ? updateProperty(db, actor, body) : deleteProperty(db, actor, body)
    })
  },
}
