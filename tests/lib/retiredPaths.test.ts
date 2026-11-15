import { expect, it } from 'vitest'
import { readRepo, trackedFiles } from '../helpers/repoFiles'

const RETIRED = /\/net-worth\b|\/data\/(close|accounts|flows|loans|real-estate|goals)\b|\/settings\/users\b|\/settings\/parameters\b/
const OWNS_REDIRECTS = 'src/routes.ts'

// Redirects hide a link left on an old address, so nothing else would catch one.
it('no source file names a moved address outside the redirect table', () => {
  const stale = trackedFiles().filter(f => f.startsWith('src/') && f !== OWNS_REDIRECTS && RETIRED.test(readRepo(f)))
  expect(stale).toEqual([])
})
