import { describe, expect, it } from 'vitest'
import { routeRight } from '../../src/server/rights'

describe('routeRight', () => {
  it.each([
    ['POST', '/api/admin/assets', 'edit'],
    ['POST', '/api/accounts/update', 'edit'],
    ['POST', '/api/accounts/delete', 'edit'],
    ['POST', '/api/accounts/month', 'edit'],
    ['POST', '/api/real-estate/update', 'edit'],
    ['POST', '/api/real-estate/delete', 'edit'],
    ['PUT', '/api/loans/1', 'edit'],
    ['DELETE', '/api/loans/1', 'edit'],
    ['PUT', '/api/admin/assets/3', 'edit'],
    ['DELETE', '/api/admin/assets/3', 'edit'],
    ['POST', '/api/admin/change_log/5/revert', 'edit'],
    ['PUT', '/api/month-close/2031-01/draft', 'edit'],
    ['POST', '/api/month-close/2031-01/close', 'edit'],
    ['POST', '/api/month-close/2031-01/reopen', 'edit'],
    ['PUT', '/api/settings', 'manage'],
    ['PUT', '/api/setup', 'manage'],
    ['POST', '/api/users', 'manage'],
    ['PUT', '/api/users/2', 'manage'],
    ['DELETE', '/api/users/2', 'manage'],
    ['POST', '/api/users/2/invite', 'manage'],
    ['POST', '/api/backup/restore', 'manage'],
    ['POST', '/api/wipe', 'manage'],
    ['POST', '/api/demo-data', 'manage'],
    ['POST', '/api/auth-settings/password', 'manage'],
    ['POST', '/api/auth-settings/bot-token', 'manage'],
    ['DELETE', '/api/auth-settings/bot-token', 'manage'],
    ['POST', '/api/auth-settings/mode', 'manage'],
  ])('every core write route needs a right: %s %s', (method, path, right) => {
    expect(routeRight(method, path)).toBe(right)
  })

  it.each([
    ['GET', '/api/users'], ['GET', '/api/admin/assets'], ['GET', '/api/demo-data'], ['GET', '/api/settings'], ['GET', '/api/backup'],
    ['POST', '/api/auth/logout'], ['POST', '/api/auth/telegram'],
    // GET /api/auth-settings checks manage in its handler
    ['GET', '/api/auth-settings'],
    // module routes check their own right (cashflow: edit on /api/spending writes)
    ['PUT', '/api/spending/manual'], ['POST', '/api/spending/categories'],
  ])('needs none: %s %s', (method, path) => {
    expect(routeRight(method, path)).toBeNull()
  })
})
