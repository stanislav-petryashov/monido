import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ESLint } from 'eslint'

// These probes replace the same virtual file repeatedly. CI's immutable single-run
// programs would otherwise retain a previous snippet's types.
beforeEach(() => { vi.stubEnv('TSESTREE_SINGLE_RUN', 'false') })
// the typed rules load the program of the whole tree: on a cold CI runner one probe outlasted the 5 s default
vi.setConfig({ testTimeout: 30_000 })

const NODE_CODE = 'export const port = process.env.PORT\n'

async function rulesFor(filePath: string): Promise<string[]> {
  const [result] = await new ESLint().lintText(NODE_CODE, { filePath })
  return result.messages.map(m => m.ruleId ?? m.message)
}

describe('eslint globals', () => {
  it('flags a Node-only global in browser code', async () => {
    expect(await rulesFor('src/pages/Login.tsx')).toContain('no-restricted-globals')
    expect(await rulesFor('src/lib/api.ts')).toContain('no-restricted-globals')
  })

  it('allows Node globals on the server, in scripts, tests and build configs', async () => {
    for (const file of ['src/server/app.ts', 'tests/server/probe.test.ts', 'vite.server.config.ts']) {
      expect(await rulesFor(file), file).not.toContain('no-restricted-globals')
    }
  })

  it('ignores local data folders and the build output', async () => {
    for (const file of ['data/probe.ts', 'data-dev/probe.ts', 'dist/client/assets/index.js']) {
      expect(await new ESLint().isPathIgnored(file), file).toBe(true)
    }
  })
})

/** Lints `code` as `filePath`; probe components are not named in capitals (an all-caps const is exempt as a constant). */
async function literalFindings(code: string, filePath = 'src/pages/Login.tsx'): Promise<string[]> {
  const [result] = await new ESLint().lintText(code, { filePath })
  return result.messages.filter(m => m.ruleId === 'i18next/no-literal-string').map(m => m.message)
}

describe('eslint translation keys', () => {
  it('flags literal text in JSX and in the text attributes of components', async () => {
    expect(await literalFindings('export const Probe = () => <p>Net worth</p>\n')).toHaveLength(1)
    expect(await literalFindings("export const Probe = (p: { on: boolean }) => <p>{p.on ? 'Yes' : 'No'}</p>\n")).toHaveLength(2)
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt', 'label']) {
      expect(await literalFindings(`export const Probe = () => <Field ${attr}="Name" />\n`), attr).toHaveLength(1)
    }
  })

  it('lets through symbols, digits, codes and non-text attributes', async () => {
    const code = [
      "export const Probe = () => <div className=\"td-num\" role=\"status\" data-testid=\"probe\">",
      "  — % × · $ 42 → <input placeholder=\"RUB\" /><input placeholder=\"Europe/Moscow\" /><Chip tone=\"success\" />",
      '</div>',
    ].join('\n')
    expect(await literalFindings(code)).toEqual([])
  })

  it('applies to components only, not to .ts code or tests', async () => {
    expect(await literalFindings("export const label = 'Net worth'\n", 'src/lib/api.ts')).toEqual([])
    expect(await literalFindings('export const Probe = () => <p>Net worth</p>\n', 'tests/pages/probe.test.tsx')).toEqual([])
  })
})


describe('eslint Promise safety', () => {
  it('rejects dropped Promises and Promise conditions in application code', async () => {
    const [result] = await new ESLint().lintText(`
      export function probe() {
        Promise.resolve(1)
        if (Promise.resolve(true)) return 1
        return 0
      }
    `, { filePath: 'src/lib/api.ts' })
    const rules = result.messages.map(m => m.ruleId)
    expect(rules).toContain('@typescript-eslint/no-floating-promises')
    expect(rules).toContain('@typescript-eslint/no-misused-promises')
  })
})
