import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A temp-dir factory whose folders the calling file's afterEach removes. Call it at the top of a test file or describe;
 * `prefix` names the folders (`<tmpdir>/<prefix>XXXXXX`).
 */
export function withTempDirs(prefix: string): () => string {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  return () => {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    dirs.push(dir)
    return dir
  }
}
