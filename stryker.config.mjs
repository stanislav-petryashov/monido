// Mutation testing of the money math (docs/development.md, "Mutation testing"): `npm run mutation`, weekly in
// .github/workflows/mutation.yml; not part of `npm run check`
export default {
  mutate: ['src/domain/**/*.ts'],
  testRunner: 'vitest',
  // the domain tests only (all in the node project): the money math must be pinned by its own tests
  testFiles: ['tests/domain/**/*.test.ts'],
  // two test runners leave a shared machine usable; `npm run mutation -- --concurrency <n>` takes more (the weekly job does)
  concurrency: 2,
  reporters: ['html', 'clear-text', 'json', 'progress'],
  // the reports go to reports/mutation/mutation.{html,json} (gitignored)
  // break is a ratchet a few points under the measured total (84.4% on 2026-11-20): a run below it fails; raise it as the
  // score grows, never lower it to make a run pass
  thresholds: { high: 80, low: 60, break: 80 },
}
