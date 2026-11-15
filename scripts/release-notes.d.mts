// Types for the plain-JS release script, so tests/scripts/releaseNotes.test.ts is type-checked (tsconfig.test.json)
export function changelogSection(changelog: string, version: string): string | null
export function commitSections(subjects: string[]): string
export function releaseBody(opts: { version: string; previousTag: string | null; repo: string; notes: string }): string
