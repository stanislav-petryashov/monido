// Bundle budgets, read by scripts/size.mjs (npm run size, after npm run build): gzip size per user scenario, a cap a little
// above the measured size. Chunk names are hashed, so each scenario's files come from the Vite manifest: the initial load is
// the entry and its static imports; the chart page adds Assets with everything it loads, statically or lazily.
// 2026-11-08: measured 185.3 kB initial load, 401.1 kB chart page (gzip); caps 187 / 406 kB.
// 2026-11-19: measured 186.8 kB initial load here and about 187.1 kB on CI (its build runs ~0.3 kB larger) after the milestones
// and the year link (the cash-flow module's yearHref is in the first load); initial cap 188 kB.
// 2026-11-20: measured 188.2 kB initial load after sign-in through an identity provider (the sign-in screen's button and
// refusals must be in the first load, before any locale chunk); the switch, invitation and notice texts are in chunks; cap 189 kB.
//
// The file lists are computed, so a build that changes the manifest shape or drops the charts from the page could shrink a
// scenario to almost nothing and still pass. The guards below throw instead: a manifest entry without the expected fields, a
// scenario with too few files, and a chart page without the ECharts code ("[ECharts] " is its log prefix, which survives
// minification).
import { readFileSync } from 'node:fs'

const DIST = new URL('./dist/client/', import.meta.url)
const MIN_FILES = { initial: 10, chartPage: 15 }
const CHART_MARKER = '[ECharts] '

function fail(message) {
  throw new Error(`.size-limit.mjs: ${message}`)
}

let MANIFEST
try {
  MANIFEST = JSON.parse(readFileSync(new URL('.vite/manifest.json', DIST), 'utf8'))
} catch (error) {
  fail(`cannot read dist/client/.vite/manifest.json (${error.code ?? error.message}): run "npm run build" first`)
}

/** Vite omits empty lists, so a list is optional, but when present it must be an array. */
function list(chunk, key, field, { required = false } = {}) {
  const value = chunk[field]
  if (value === undefined && !required) return []
  if (!Array.isArray(value)) fail(`manifest entry ${key} has no "${field}" array: did the manifest format change?`)
  return value
}

/**
 * Every JS and CSS file reachable from the manifest keys, as paths relative to dist/client, and the manifest keys visited.
 * Static imports always count; dynamic ones (import(), lazy()) only from chunks outside `noDynamic`. The roots must list
 * their imports: that is what a renamed field breaks.
 */
function closure(roots, { noDynamic = null } = {}) {
  const seen = new Set()
  const files = new Set()
  const visit = (key, isRoot) => {
    if (seen.has(key)) return
    seen.add(key)
    const chunk = MANIFEST[key]
    if (!chunk) fail(`manifest has no entry ${key}`)
    if (typeof chunk.file !== 'string') fail(`manifest entry ${key} has no "file"`)
    files.add(chunk.file)
    for (const css of list(chunk, key, 'css')) files.add(css)
    for (const imported of list(chunk, key, 'imports', { required: isRoot })) visit(imported, false)
    if (noDynamic && !noDynamic.has(key)) for (const lazy of list(chunk, key, 'dynamicImports')) visit(lazy, false)
  }
  roots.forEach(root => visit(root, true))
  return { files, keys: seen }
}

const { files: initial, keys: initialKeys } = closure(['index.html'])
const chartPage = new Set([...initial, ...closure(['src/pages/Assets.tsx'], { noDynamic: initialKeys }).files])

if (initial.size < MIN_FILES.initial) fail(`the initial load has ${initial.size} files, expected at least ${MIN_FILES.initial}`)
if (chartPage.size < MIN_FILES.chartPage) fail(`the chart page has ${chartPage.size} files, expected at least ${MIN_FILES.chartPage}`)
if (![...chartPage].some(file => file.endsWith('.js') && readFileSync(new URL(file, DIST), 'utf8').includes(CHART_MARKER))) {
  fail(`no file of the chart page contains ${JSON.stringify(CHART_MARKER)}: the page no longer reaches the ECharts code, so the budget would not guard it`)
}

// Overview is the first page of every visit: its history chart stays behind a lazy import, or ECharts would load with it.
const overviewFiles = closure(['src/pages/Overview.tsx']).files
if ([...overviewFiles].some(file => file.endsWith('.js') && readFileSync(new URL(file, DIST), 'utf8').includes(CHART_MARKER))) {
  fail('Overview reaches the ECharts code without a lazy import: the first page of every visit would load it')
}

const paths = files => [...files].map(file => `dist/client/${file}`)

export default [
  { name: 'initial load', path: paths(initial), gzip: true, limit: '189 kB' },
  { name: 'chart page (initial load + Assets)', path: paths(chartPage), gzip: true, limit: '406 kB' },
]
