// Type assertions, run by Vitest's typecheck (vitest.config.ts): they have no runtime, `tsc` is the test.
import { expectTypeOf, test } from 'vitest'
import type { FamilySettings, Row } from '../../src/domain/api'
import { apiFetch, apiSend } from '../../src/lib/api'

test('apiFetch<T> answers with T and has no default', () => {
  expectTypeOf(apiFetch<FamilySettings>('/api/settings')).toEqualTypeOf<Promise<FamilySettings>>()
  // an un-annotated read is `unknown`: the caller has to say what the endpoint answers with
  expectTypeOf(apiFetch('/api/snapshot')).toEqualTypeOf<Promise<unknown>>()
})

test('apiSend<T> answers with T, and with nothing by default', () => {
  expectTypeOf(apiSend<Row>('/api/admin/assets', 'POST', { name: 'Cash' })).toEqualTypeOf<Promise<Row>>()
  expectTypeOf(apiSend('/api/admin/assets/7', 'DELETE')).toEqualTypeOf<Promise<void>>()
})
