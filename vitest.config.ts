import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// .ts tests outside tests/components and tests/pages that still need a DOM (window, document, localStorage, React hooks)
const DOM_TS = [
  'tests/lib/api.test.ts',
  'tests/lib/authState.test.ts',
  'tests/lib/chartColors.test.ts',
  'tests/lib/clipboard.test.ts',
  'tests/lib/demoCountdown.test.ts',
  'tests/lib/pageFocus.test.ts',
  'tests/lib/period.test.ts',
  'tests/lib/recordLink.test.ts',
  'tests/i18n/client.test.ts',
  'tests/i18n/chunkLoads.test.ts',
]
const DOM_DIRS = ['tests/components/**', 'tests/pages/**']
// files that need a process of their own (pool forks, not a vm in a worker thread): eslint-plugin-i18next checks
// `instanceof RegExp`, and a RegExp from the config's realm fails it
const OUTSIDE_VM = ['tests/config/eslint.test.ts']
// the server, module and demo-family tests open node:sqlite databases; in worker threads node:sqlite work contends
// (measured: the whole suite 16.3 s on vmThreads, 7.4 s with these files on forks), so they run in child processes
const SQLITE = ['tests/server/**/*.test.ts', 'tests/modules/**/*.test.ts', 'tests/demo/**/*.test.ts']

// Projects (docs/architecture.md, "Testing"): vmThreads creates an environment once per worker, not once per file;
// node is the default for .ts files, sqlite (forks) for the database-backed ones, jsdom for .tsx and the component
// and page folders
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // before each test: vi.stubGlobal / vi.stubEnv undone, vi.spyOn spies restored, and every vi.fn reset to the
    // implementation it was created with — a once-value a test queued and left unused (mockReturnValueOnce…) does not
    // answer the next test's call; an implementation set later (mockImplementation) is dropped too, so a file sets it
    // in beforeEach (tests/harness/mockReset.test.ts)
    unstubGlobals: true,
    unstubEnvs: true,
    restoreMocks: true,
    mockReset: true,
    // tests and files run in a random order (the seed is printed): a test that needs another to run first fails at once;
    // `--sequence.seed=<n>` repeats an order
    sequence: { shuffle: true },
    // coverage ratchet: `npm test` measures src/** and fails below these floors (measured 2026-11-20: 95.49 / 91.61 / 95.25 /
    // 98.04). Raise a floor when the measure has moved up for good; lowering one is a decision for the PR description
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: { statements: 95, branches: 91, functions: 95, lines: 97.5 },
    },
    setupFiles: ['./tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          pool: 'vmThreads',
          setupFiles: ['./tests/setup.node.ts'],
          include: ['tests/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...DOM_TS, ...DOM_DIRS, ...OUTSIDE_VM, ...SQLITE],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          pool: 'vmThreads',
          setupFiles: ['./tests/setup.dom.ts'],
          include: ['tests/**/*.test.tsx', ...DOM_DIRS.map(d => `${d}/*.test.ts`), ...DOM_TS],
        },
      },
      {
        extends: true,
        test: { name: 'sqlite', environment: 'node', pool: 'forks', setupFiles: ['./tests/setup.node.ts'], include: SQLITE },
      },
      {
        extends: true,
        test: { name: 'forks', environment: 'node', pool: 'forks', include: OUTSIDE_VM },
      },
    ],
  },
})
