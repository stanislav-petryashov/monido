// Regenerates the README screenshot and the social preview: npm run screenshots
// Builds the app (a stale dist/ would shoot old code), starts the built server on a throwaway database seeded from the fictional family of
// src/demo/family.ts (the only data source: nothing real can reach the images), captures the Overview page
// in both themes with Chrome, and composites the shots with local HTML pages.
// Needs Google Chrome (PW_CHANNEL selects another Playwright channel, e.g. chrome-beta or msedge); no network:
// the exchange rates are the family's own embedded ones.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { DatabaseSync } from 'node:sqlite'
import { buildFamily } from '../src/demo/family'
import { writeFamily } from '../src/server/demo/writeFamily'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'docs', 'assets')
const PASSWORD = 'screenshots-throwaway'

/** The README pitch and the GitHub description (docs/maintaining.md); tests/docs/readme.test.ts keeps the three equal. */
const PITCH = 'Track your net worth and cash flow, on your own or as a family. Self-hosted, entered by hand, no bank connections.'

const SHOT = { width: 1440, height: 900, scale: 2 }
/** Where the dark theme starts: the clip polygon of the cut. */
const CUT = 'polygon(58% 0, 100% 0, 100% 100%, 42% 100%)'
/** The composite is 1600 px wide; its device scale factor drops until the file fits. */
const COMPOSITE = { width: 1600, scales: [2, 1.5, 1], maxBytes: 1.5 * 1024 * 1024 }
const SOCIAL = { width: 1280, height: 640, maxBytes: 1024 * 1024 }

/** The app follows the device theme: the browser context's colour scheme. */
type Theme = 'light' | 'dark'

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolvePort(port))
    })
  })
}

function build(): void {
  const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (build.status !== 0) throw new Error('npm run build failed')
}

async function waitFor(check: () => Promise<boolean>, what: string, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

const isUp = (base: string) => async () => {
  try { return (await fetch(`${base}/api/health`)).ok } catch { return false }
}

function stopServer(child: ChildProcess): Promise<void> {
  return new Promise(resolveStop => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveStop()
    child.once('exit', () => resolveStop())
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 5000).unref()
  })
}

/** The design-token block of tokens.css (both themes), so the templates carry no colours of their own. */
function readTokens(): string {
  const css = readFileSync(join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8')
  const end = css.indexOf('/* ── Reset')
  if (end < 0) throw new Error('tokens.css: the reset marker moved, update scripts/screenshots.ts')
  return css.slice(0, end)
}

const dataUri = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`

const ONEST = join(ROOT, 'node_modules', '@fontsource-variable', 'onest', 'files', 'onest-latin-wght-normal.woff2')

function pageHtml(body: string, css: string): string {
  const font = dataUri('font/woff2', readFileSync(ONEST))
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@font-face { font-family: 'Onest Variable'; font-weight: 100 900; src: url(${font}) format('woff2'); }
${readTokens()}
html, body { margin: 0; background: var(--bg); font-family: var(--font); }
${css}
</style></head><body>${body}</body></html>`
}

/** Both shots stacked at full size; the dark one is clipped to the cut, with a 2 px line along it. */
function compositeHtml(light: Buffer, dark: Buffer): string {
  const h = (COMPOSITE.width * SHOT.height) / SHOT.width
  const [x1, x2] = [0.58, 0.42].map(f => f * COMPOSITE.width)
  return pageHtml(`
<div class="frame">
  <img src="${dataUri('image/png', light)}" alt="">
  <img class="dark" src="${dataUri('image/png', dark)}" alt="">
  <svg viewBox="0 0 ${COMPOSITE.width} ${h}" width="${COMPOSITE.width}" height="${h}">
    <line x1="${x1}" y1="0" x2="${x2}" y2="${h}" />
  </svg>
</div>`, `
.frame { position: relative; width: ${COMPOSITE.width}px; height: ${h}px; overflow: hidden; }
.frame img, .frame svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.dark { clip-path: ${CUT}; }
line { stroke: var(--primary); stroke-width: 2; }`)
}

/** The logo, the name, the pitch and a slice of the light screenshot running off the right and bottom edges. */
function socialHtml(light: Buffer): string {
  return pageHtml(`
<main>
  <section>
    <svg class="logo" viewBox="0 0 48 48" width="96" height="96">
      <path d="M14 0 H34 C43.2 0 48 4.8 48 14 V34 C48 43.2 43.2 48 34 48 H14 C4.8 48 0 43.2 0 34 V14 C0 4.8 4.8 0 14 0 Z" style="fill: var(--brand)"/>
      <path d="M13 39 V20.5 C14.5 27.5 18.5 29.5 23 29.5 C28.5 29.5 34 23 35 11.5 V39" fill="none" stroke-width="5.5" stroke-linecap="butt" stroke-linejoin="round" style="stroke: var(--on-fill)"/>
    </svg>
    <h1>Monido</h1>
    <p>${PITCH.replace('Self-hosted', '<span class="keep">Self-hosted</span>')}</p>
  </section>
  <div class="shot"><img src="${dataUri('image/png', light)}" alt=""></div>
</main>`, `
main { position: relative; width: ${SOCIAL.width}px; height: ${SOCIAL.height}px; overflow: hidden; background: var(--bg); }
section { position: absolute; left: 72px; top: 0; bottom: 0; width: 440px; display: flex; flex-direction: column; justify-content: center; gap: var(--sp-3); }
h1 { margin: 0; font-size: 60px; line-height: 1.05; font-weight: 600; letter-spacing: -0.02em; color: var(--text-1); }
p .keep { white-space: nowrap; }
p { margin: 0; font-size: 24px; line-height: 1.4; color: var(--text-3); }
.shot { position: absolute; left: 580px; top: 96px; width: 1120px; border-radius: var(--r-dialog); overflow: hidden; box-shadow: var(--shadow-lg); outline: 1px solid var(--rule); }
.shot img { display: block; width: 100%; }`)
}

async function capture(context: BrowserContext, base: string): Promise<Buffer> {
  const page = await context.newPage()
  try {
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Overview' }).waitFor()
    await page.evaluate('document.fonts.ready')
    await page.waitForTimeout(1500) // chart entrance animations
    return await page.screenshot()
  } finally {
    await page.close()
  }
}

async function shootOverview(browser: Browser, base: string, theme: Theme): Promise<Buffer> {
  const context = await browser.newContext({
    viewport: { width: SHOT.width, height: SHOT.height }, deviceScaleFactor: SHOT.scale, locale: 'en-US', colorScheme: theme,
  })
  try {
    const login = await context.request.post(`${base}/api/auth/login`, { data: { password: PASSWORD } })
    if (!login.ok()) throw new Error(`Sign-in failed: HTTP ${login.status()}`)
    return await capture(context, base)
  } finally {
    await context.close()
  }
}

async function renderHtml(browser: Browser, html: string, width: number, height: number, scale: number): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale })
  try {
    const page = await context.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate('document.fonts.ready')
    return await page.screenshot({ type: 'png' })
  } finally {
    await context.close()
  }
}

async function main(): Promise<void> {
  build()
  const dataDir = mkdtempSync(join(tmpdir(), 'ff-screenshots-'))
  let server: ChildProcess | null = null
  let browser: Browser | null = null
  const cleanup = async () => {
    await browser?.close().catch(() => undefined)
    if (server) await stopServer(server)
    rmSync(dataDir, { recursive: true, force: true })
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void cleanup().then(() => process.exit(1)) })
  try {
    const port = await freePort()
    const base = `http://127.0.0.1:${port}`
    server = spawn(process.execPath, [join(ROOT, 'dist', 'server', 'main.js')], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' },
      stdio: 'ignore',
    })
    await waitFor(isUp(base), 'the server (/api/health)')
    const setup = await fetch(`${base}/api/auth/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'password', password: PASSWORD }) })
    if (!setup.ok) throw new Error(`Sign-in setup failed: ${setup.status}`)
    const file = join(dataDir, 'finance.sqlite')
    const db = new DatabaseSync(file)
    try {
      db.exec('PRAGMA busy_timeout = 5000')
      writeFamily(db, buildFamily())
    } finally {
      db.close()
    }

    browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' })
    const light = await shootOverview(browser, base, 'light')
    const dark = await shootOverview(browser, base, 'dark')

    mkdirSync(ASSETS, { recursive: true })
    const compositeHeight = (COMPOSITE.width * SHOT.height) / SHOT.width
    const html = compositeHtml(light, dark)
    let screenshot: Buffer | null = null
    for (const scale of COMPOSITE.scales) {
      screenshot = await renderHtml(browser, html, COMPOSITE.width, compositeHeight, scale)
      if (screenshot.length <= COMPOSITE.maxBytes) break
    }
    if (!screenshot || screenshot.length > COMPOSITE.maxBytes) throw new Error(`screenshot.png is over ${COMPOSITE.maxBytes} bytes even at scale 1`)
    writeFileSync(join(ASSETS, 'screenshot.png'), screenshot)

    const social = await renderHtml(browser, socialHtml(light), SOCIAL.width, SOCIAL.height, 1)
    if (social.length > SOCIAL.maxBytes) throw new Error(`social-preview.png is over ${SOCIAL.maxBytes} bytes`)
    writeFileSync(join(ASSETS, 'social-preview.png'), social)

    for (const name of ['screenshot.png', 'social-preview.png']) {
      console.log(`docs/assets/${name}: ${Math.round(statSync(join(ASSETS, name)).size / 1024)} KB`)
    }
  } finally {
    await cleanup()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
