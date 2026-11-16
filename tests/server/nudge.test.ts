import { afterEach, describe, expect, it, vi } from 'vitest'
import { advisorServer } from '../../src/modules/advisor/server'
import { nudgeModules } from '../../src/server/app'
import { createTestDb, testConfig } from '../helpers/db'
import { authFor } from '../helpers/auth'

afterEach(() => { vi.restoreAllMocks() })

describe('nudgeModules', () => {
  it('runs every module\'s onNudge with the module env and survives a failing one', async () => {
    const db = createTestDb()
    const config = testConfig({ APP_URL: 'https://family.test' })
    const auth = authFor(config)
    const nudge = vi.spyOn(advisorServer, 'onNudge')
    nudge.mockResolvedValueOnce(undefined)
    await nudgeModules({ db, config, auth })
    expect(nudge).toHaveBeenCalledWith(expect.objectContaining({ db, auth, env: expect.objectContaining({ APP_URL: 'https://family.test' }) }))

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    nudge.mockRejectedValueOnce(new Error('down'))
    await expect(nudgeModules({ db, config, auth })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('[nudge]', 'advisor', 'failed')
  })
})
