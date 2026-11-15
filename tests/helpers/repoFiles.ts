import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The repository root. */
export const ROOT = join(__dirname, '..', '..')

/** The text of a repository file, by its path from the root. */
export const readRepo = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

let tracked: string[] | undefined

/** Tracked files plus new ones not yet added, minus ignored ones (paths from the root): the set a commit could publish. Listed once per worker. */
export function trackedFiles(): string[] {
  tracked ??= execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(path => path && existsSync(join(ROOT, path)))
  return tracked
}

/** Absolute paths of the files under src/ (recursively) whose name matches `name`, e.g. /\.tsx?$/. */
export function srcFiles(name: RegExp, dir = join(ROOT, 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return srcFiles(name, path)
    return name.test(entry.name) ? [path] : []
  })
}
