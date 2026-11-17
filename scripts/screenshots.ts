// Regenerates the README images of every language (docs/assets/screens/<lang>/) and the social preview: npm run screenshots
// Builds the app (a stale dist/ would shoot old code), starts the built server on a throwaway database per language, seeded
// from that language's fictional family of src/demo/family.ts (the only data source: nothing real can reach the images),
// captures its screens with Chrome and composites them with local HTML pages: a headline and a line from the family's
// `screenshots` captions (src/demo/<lang>.json) over a crop of the real screen.
// Needs Google Chrome (PW_CHANNEL selects another Playwright channel, e.g. chrome-beta or msedge); no network:
// the exchange rates are the families' own embedded ones. LANGS=en-US,ru-RU limits the languages.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { DatabaseSync } from 'node:sqlite'
import { buildFamily, demoFamilyLanguage, familyCurrency } from '../src/demo/family'
import type { DemoStrings, ScreenshotKey } from '../src/demo/strings'
import { LANGUAGES, type Language } from '../src/i18n/languages'
import type { FinanceSnapshot } from '../src/domain/types'
import { shiftMonth, monthOf, isoDate } from '../src/domain/dates'
import { writeFamily } from '../src/server/demo/writeFamily'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'docs', 'assets')
const PASSWORD = 'screenshots-throwaway'

/** The README pitch and the GitHub description (docs/maintaining.md); tests/docs/readme.test.ts keeps the three equal. */
const PITCH = 'Track your net worth and cash flow, on your own or as a family. Self-hosted, entered by hand, no bank connections.'

/** Every image is this page size, rendered at SCALE and saved as WebP under MAX_BYTES; the social preview is a PNG. */
const PAGE = { width: 1440, height: 900 }
const SCALE = 1.5
const MAX_BYTES = 400 * 1024
const SOCIAL = { width: 1280, height: 640, maxBytes: 1024 * 1024 }
/** The screens behind the gallery images: the route, and the element whose top starts the crop */
const GALLERY: { key: Exclude<ScreenshotKey, 'hero' | 'phone'>; route: string; from: string }[] = [
  { key: 'close', route: '/close', from: 'main .card' },
  { key: 'goals', route: '/goals', from: 'main .card' },
  { key: 'cashflow', route: '/cashflow', from: 'main .card' },
  { key: 'assets', route: '/assets', from: 'main .card' },
  { key: 'health', route: '/health', from: 'main h2' },
]
/** Close month is shot with this many accounts filled in from last month's figures, so the wizard is caught at work. */
const FILLED = 4

type Theme = 'light' | 'dark'
interface Holding { owner: string; name: string; currency: string; value: number; debt: boolean }

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
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** A caption's line break (the hero's two lines) becomes <br> */
const lines = (s: string) => escapeHtml(s).replace(/\n/g, '<br>')

const FONTS = join(ROOT, 'node_modules', '@fontsource-variable', 'onest', 'files')
/** Onest's latin and cyrillic subsets with their ranges; Chinese falls back to the system's CJK face */
const FONT_FACES: [string, string][] = [
  ['onest-latin-wght-normal.woff2', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20A0-20CF, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'],
  ['onest-latin-ext-wght-normal.woff2', 'U+0100-024F, U+1E00-1EFF, U+2C60-2C7F, U+A720-A7FF'],
  ['onest-cyrillic-wght-normal.woff2', 'U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'],
]

const LOGO = `<svg class="logo" viewBox="0 0 48 48" aria-hidden="true">
  <path d="M14 0 H34 C43.2 0 48 4.8 48 14 V34 C48 43.2 43.2 48 34 48 H14 C4.8 48 0 43.2 0 34 V14 C0 4.8 4.8 0 14 0 Z" style="fill: var(--brand)"/>
  <path d="M13 39 V20.5 C14.5 27.5 18.5 29.5 23 29.5 C28.5 29.5 34 23 35 11.5 V39" fill="none" stroke-width="5.5" stroke-linejoin="round" style="stroke: var(--on-fill)"/>
</svg>`

function pageHtml(lang: Language, size: { width: number; height: number }, body: string, css: string): string {
  const faces = FONT_FACES.map(([file, range]) =>
    `@font-face { font-family: 'Onest Variable'; font-weight: 100 900; src: url(${dataUri('font/woff2', readFileSync(join(FONTS, file)))}) format('woff2'); unicode-range: ${range}; }`).join('\n')
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
${faces}
${readTokens()}
* { box-sizing: border-box; }
html, body { margin: 0; width: ${size.width}px; height: ${size.height}px; overflow: hidden; background: var(--bg); color: var(--text-1);
  font-family: 'Onest Variable', 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', system-ui, sans-serif; }
.brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 600; white-space: nowrap; }
.logo { width: 36px; height: 36px; }
h1 { margin: 0; font-weight: 500; letter-spacing: -0.025em; line-height: 1.06; }
.sub { margin: 14px 0 0; color: var(--text-2); font-size: 20px; line-height: 1.45; }
.shot { position: absolute; overflow: hidden; border-radius: var(--r-dialog); background: var(--paper);
  box-shadow: 0 1px 2px rgb(27 26 36 / .06), 0 24px 60px -12px rgb(42 30 120 / .22); }
.shot img { display: block; width: 100%; }
.top { position: absolute; left: 72px; top: 60px; right: 72px; display: flex; justify-content: space-between; align-items: flex-start; gap: 48px; }
${css}
</style></head><body>${body}</body></html>`
}

/** A holding's amount in its own currency, as the language writes money, whole units */
const money = (lang: Language, currency: string, value: number) =>
  new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)

/** The hero: the family's holdings and loans on the left, curves into the real net worth card on the right. */
function heroHtml(lang: Language, caption: { title: string; sub: string }, holdings: Holding[], card: Buffer): string {
  const rowH = 54, gap = 8, top = 262
  const chips = holdings.map(h => `<li class="${h.debt ? 'debt' : ''}"><span class="who">${escapeHtml([...h.owner][0] ?? '')}</span>`
    + `<span class="n">${escapeHtml(h.name)}</span><span class="c">${h.currency}</span>`
    + `<span class="v">${escapeHtml(money(lang, h.currency, h.debt ? -h.value : h.value))}</span></li>`).join('')
  const target = 290
  const curves = holdings.map((h, i) => {
    const y = i * (rowH + gap) + rowH / 2
    return `<path d="M0 ${y} C130 ${y} 130 ${target} 250 ${target}"${h.debt ? ' class="debt"' : ''}/>`
  }).join('')
  return pageHtml(lang, PAGE, `
<div class="top"><div><h1>${lines(caption.title)}</h1><p class="sub">${escapeHtml(caption.sub)}</p></div><div class="brand">${LOGO}Monido</div></div>
<ul>${chips}</ul>
<svg class="flow" viewBox="0 0 250 ${holdings.length * (rowH + gap)}" width="250" height="${holdings.length * (rowH + gap)}" fill="none">${curves}<circle cx="246" cy="${target}" r="5"/></svg>
<div class="shot card"><img src="${dataUri('image/png', card)}" alt=""></div>`, `
h1 { font-size: 56px; }
ul { position: absolute; left: 72px; top: ${top}px; margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: minmax(0, 1fr); gap: ${gap}px; width: 470px; }
li { height: ${rowH}px; display: flex; align-items: center; gap: 12px; padding: 0 16px; background: var(--paper); border-radius: 14px; font-size: 17px; }
li.debt { background: none; outline: 1.5px dashed var(--rule); outline-color: rgb(27 26 36 / .2); }
.who { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 600;
  background: color-mix(in srgb, var(--primary) 14%, var(--paper)); color: var(--primary-text); }
.n { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.c { font-size: 12px; color: var(--text-3); border: 1px solid var(--rule); border-radius: 6px; padding: 2px 6px; }
.v { font-variant-numeric: tabular-nums; white-space: nowrap; }
.debt .v { color: var(--text-2); }
.flow { position: absolute; left: 542px; top: ${top}px; }
.flow path { stroke: var(--primary); stroke-opacity: .4; stroke-width: 1.5; }
.flow path.debt { stroke: var(--text-1); stroke-opacity: .5; stroke-dasharray: 4 5; }
.flow circle { fill: var(--primary); }
.card { left: 792px; top: ${top + target - 165}px; width: 576px; }`)
}

/** A gallery image: the caption over a crop of the real screen, cut off by the bottom edge. */
function galleryHtml(lang: Language, caption: { title: string; sub: string }, screen: Buffer): string {
  return pageHtml(lang, PAGE, `
<div class="top"><div><h1>${lines(caption.title)}</h1><p class="sub">${escapeHtml(caption.sub)}</p></div><div class="brand">${LOGO}Monido</div></div>
<div class="shot crop"><img src="${dataUri('image/png', screen)}" alt=""></div>`, `
h1 { font-size: 52px; }
.sub { max-width: 840px; }
.crop { left: 72px; top: 236px; width: 1296px; height: 700px; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }`)
}

/** Two phones, light and dark, beside the caption. */
function phoneHtml(lang: Language, caption: { title: string; sub: string }, light: Buffer, dark: Buffer): string {
  return pageHtml(lang, PAGE, `
<div class="side"><div class="brand">${LOGO}Monido</div><h1>${lines(caption.title)}</h1><p class="sub">${escapeHtml(caption.sub)}</p></div>
<div class="phone" style="left: 690px; top: 96px"><img src="${dataUri('image/png', light)}" alt=""></div>
<div class="phone" style="left: 1060px; top: 150px"><img src="${dataUri('image/png', dark)}" alt=""></div>`, `
.side { position: absolute; left: 72px; top: 0; bottom: 0; width: 580px; display: flex; flex-direction: column; justify-content: center; gap: 24px; }
h1 { font-size: 52px; }
.sub { margin: 0; }
.phone { position: absolute; width: 330px; height: 714px; overflow: hidden; border-radius: 52px; outline: 10px solid var(--text-1);
  box-shadow: 0 30px 70px -18px rgb(42 30 120 / .35); }
.phone img { display: block; width: 100%; }`)
}

/** The social preview: the hero's headline, the pitch, a few holdings and the net worth card. */
function socialHtml(title: string, holdings: Holding[], card: Buffer): string {
  const chips = holdings.slice(0, 6).map(h => `<li class="${h.debt ? 'debt' : ''}"><span class="n">${escapeHtml(h.name)}</span>`
    + `<span>${escapeHtml(money('en-US', h.currency, h.debt ? -h.value : h.value))}</span></li>`).join('')
  return pageHtml('en-US', SOCIAL, `
<div class="side"><div class="brand">${LOGO}Monido</div><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(PITCH)}</p></div>
<ul>${chips}</ul>
<div class="shot card"><img src="${dataUri('image/png', card)}" alt=""></div>`, `
.side { position: absolute; left: 64px; top: 56px; width: 560px; }
h1 { margin-top: 36px; font-size: 50px; }
.sub { font-size: 19px; }
ul { position: absolute; left: 64px; bottom: 48px; width: 560px; margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
li { display: flex; gap: 8px; padding: 9px 12px; background: var(--paper); border-radius: 12px; font-size: 15px; }
li.debt { background: none; outline: 1.5px dashed rgb(27 26 36 / .2); }
.n { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card { left: 680px; top: 160px; width: 560px; }`)
}

/** A signed-in browser context at the family's language, with the clock on the 25th of the open month: the data is then a
 * month old, as for a family that closes each month soon after it ends (the real date would show it as stale). */
async function signedIn(browser: Browser, base: string, lang: Language, clock: string, viewport: { width: number; height: number }, scale: number, theme: Theme = 'light'): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: lang, colorScheme: theme })
  await context.clock.install({ time: new Date(clock) })
  const login = await context.request.post(`${base}/api/auth/login`, { data: { password: PASSWORD } })
  if (!login.ok()) throw new Error(`Sign-in failed: HTTP ${login.status()}`)
  return context
}

/** Opens a route and waits for its title, the fonts and the chart entrance animations. */
async function open(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.locator('h1').first().waitFor()
  await page.evaluate('document.fonts.ready')
  await page.waitForTimeout(1500)
  return page
}

/** The page's content column (the sidebar left out) from `from`'s top, down to the bottom of the viewport. */
async function cropFrom(page: Page, from: string): Promise<Buffer> {
  // typing into a form scrolls it: the crop always starts from the top of the page
  await page.evaluate("for (const el of [document.scrollingElement, ...document.querySelectorAll('main, .shell__content')]) if (el) el.scrollTop = 0")
  await page.waitForTimeout(300)
  const main = await page.locator('main').first().boundingBox()
  const start = await page.locator(from).first().boundingBox()
  if (!main || !start) throw new Error(`${page.url()}: no ${from} to crop from`)
  const view = page.viewportSize()!
  const y = Math.max(0, start.y - 24)
  return page.screenshot({ clip: { x: main.x, y, width: view.width - main.x, height: view.height - y } })
}

/** Close month with the first accounts filled from the hints of last month's figures, then shot from its progress card. */
async function shootClose(context: BrowserContext, base: string): Promise<Buffer> {
  const page = await open(context, `${base}/close`)
  for (const input of await page.locator('main input').all()) {
    const filled = /(\d+)\D{1,6}6\b/.exec(await page.locator('main .card').first().innerText())
    if (filled && Number(filled[1]) >= FILLED) break
    if (!(await input.isVisible()) || (await input.inputValue()) !== '') continue
    // a field's own hint ("in September: 5,450"; Chinese writes a full-width colon) sits within two levels of it; a field without one (a broker's
    // contributions) gets 0, never the account's balance from the heading further up
    const around = await input.locator('xpath=ancestor::*[position() <= 2][contains(., ":") or contains(., "\uFF1A")][1]').innerText().catch(() => '')
    const hint = /[:\uFF1A]\s*([\d\s\u00a0\u202f.,]*\d)/.exec(around)?.[1] ?? '0'
    await input.fill(hint.replace(/[\s\u00a0\u202f]/g, ''))
    await input.blur()
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(800)
  const png = await cropFrom(page, 'main .card')
  await page.close()
  return png
}

/** Goals with the independence goal selected: its forecast band is the page's richest chart. */
async function shootGoals(context: BrowserContext, base: string, fire: string): Promise<Buffer> {
  const page = await open(context, `${base}/goals`)
  await page.getByText(fire, { exact: true }).first().click()
  await page.waitForTimeout(1500)
  const png = await cropFrom(page, 'main .card')
  await page.close()
  return png
}

/** The left part of the Overview's net worth card: the figure, its changes and the owned-versus-loans bar. */
async function shootCard(context: BrowserContext, base: string): Promise<Buffer> {
  const page = await open(context, base)
  const box = await page.locator('.nw').first().boundingBox()
  if (!box) throw new Error('Overview: no net worth card')
  const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width * 0.5, 620), height: box.height } })
  await page.close()
  return png
}

/** The holdings behind the hero: accounts, properties and loans of the last closed month, each in its own currency. */
async function holdingsOf(context: BrowserContext, base: string): Promise<Holding[]> {
  const res = await context.request.get(`${base}/api/snapshot`)
  if (!res.ok()) throw new Error(`/api/snapshot: HTTP ${res.status()}`)
  const capital = (await res.json() as FinanceSnapshot).capital
  if (!capital) throw new Error('/api/snapshot: no capital')
  return [
    ...capital.accounts.map(a => ({ owner: a.member, name: a.name, currency: a.currency, value: a.value, debt: false })),
    ...capital.realEstate.map(r => ({ owner: r.member, name: r.name, currency: r.currency, value: r.value, debt: false })),
    ...capital.loans.map(l => ({ owner: l.member, name: l.name, currency: l.currency, value: l.balance, debt: true })),
  ]
}

/** Renders a template page; WebP through Chrome's own encoder (no image library), PNG as Playwright shoots it. */
async function render(browser: Browser, html: string, size: { width: number; height: number }, scale: number, type: 'webp' | 'png'): Promise<Buffer> {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: scale })
  try {
    const page = await context.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate('document.fonts.ready')
    const png = await page.screenshot({ type: 'png' })
    if (type === 'png') return png
    // a string, not a function: the scripts are type-checked without the DOM library
    const webp = await page.evaluate(`(async () => {
      const img = new Image()
      img.src = ${JSON.stringify(dataUri('image/png', png))}
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      return canvas.toDataURL('image/webp', 0.86)
    })()`) as string
    return Buffer.from(webp.split(',')[1], 'base64')
  } finally {
    await context.close()
  }
}

function save(file: string, bytes: Buffer, max: number): void {
  if (bytes.length > max) throw new Error(`${file} is ${Math.round(bytes.length / 1024)} KB, over ${Math.round(max / 1024)} KB`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, bytes)
  console.log(`${file.slice(ROOT.length + 1)}: ${Math.round(statSync(file).size / 1024)} KB`)
}

/** One language: a server on a fresh database with that language's family, its seven images, and the English social preview. */
async function shootLanguage(browser: Browser, lang: Language): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'ff-screenshots-'))
  let server: ChildProcess | null = null
  try {
    const port = await freePort()
    const base = `http://127.0.0.1:${port}`
    const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version
    server = spawn(process.execPath, [join(ROOT, 'dist', 'server', 'main.js')], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', APP_VERSION: `v${version}` },
      stdio: 'ignore',
    })
    await waitFor(isUp(base), 'the server (/api/health)')
    const setup = await fetch(`${base}/api/auth/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'password', password: PASSWORD }) })
    if (!setup.ok) throw new Error(`Sign-in setup failed: ${setup.status}`)
    const today = isoDate(new Date())
    const family = buildFamily({ today, family: demoFamilyLanguage(lang) })
    const db = new DatabaseSync(join(dataDir, 'finance.sqlite'))
    try {
      db.exec('PRAGMA busy_timeout = 5000')
      writeFamily(db, family)
      const setting = db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
      setting.run('currency', familyCurrency(family))
      setting.run('language', lang)
    } finally {
      db.close()
    }
    const strings = JSON.parse(readFileSync(join(ROOT, 'src', 'demo', `${lang}.json`), 'utf8')) as DemoStrings
    const captions = strings.screenshots
    const clock = `${shiftMonth(monthOf(today), -1)}-25T10:00:00Z`
    const out = (name: string) => join(ASSETS, 'screens', lang, `${name}.webp`)

    const desktop = await signedIn(browser, base, lang, clock, PAGE, 2)
    const holdings = await holdingsOf(desktop, base)
    const card = await shootCard(desktop, base)
    const hero = await render(browser, heroHtml(lang, captions.hero, holdings, card), PAGE, SCALE, 'webp')
    save(out('hero'), hero, MAX_BYTES)
    // the demo's sign-in shows the same image beside the families (src/pages/Login.tsx)
    save(join(ROOT, 'public', 'demo', `hero-${lang}.webp`), hero, MAX_BYTES)
    for (const shot of GALLERY) {
      const screen = shot.key === 'close' ? await shootClose(desktop, base)
        : shot.key === 'goals' ? await shootGoals(desktop, base, strings.goals.fire)
          : await cropFrom(await open(desktop, base + shot.route), shot.from)
      save(out(shot.key), await render(browser, galleryHtml(lang, captions[shot.key], screen), PAGE, SCALE, 'webp'), MAX_BYTES)
    }
    await desktop.close()

    const phones: Buffer[] = []
    for (const theme of ['light', 'dark'] as const) {
      const phone = await signedIn(browser, base, lang, clock, { width: 390, height: 844 }, 2, theme)
      const page = await open(phone, base)
      phones.push(await page.screenshot())
      await phone.close()
    }
    save(out('phone'), await render(browser, phoneHtml(lang, captions.phone, phones[0], phones[1]), PAGE, SCALE, 'webp'), MAX_BYTES)

    if (lang === 'en-US') {
      const social = await render(browser, socialHtml(captions.hero.title.replace(/\n/g, ' '), holdings, card), SOCIAL, 1, 'png')
      save(join(ASSETS, 'social-preview.png'), social, SOCIAL.maxBytes)
    }
  } finally {
    if (server) await stopServer(server)
    rmSync(dataDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const only = process.env.LANGS?.split(',').filter(Boolean)
  const langs = only ? LANGUAGES.filter(l => only.includes(l)) : LANGUAGES
  build()
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void browser.close().then(() => process.exit(1)) })
  try {
    for (const lang of langs) await shootLanguage(browser, lang)
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
