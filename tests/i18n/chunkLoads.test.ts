import advisorEn from '../../src/locales/advisor/en-US.json'
import advisorRu from '../../src/locales/advisor/ru-RU.json'

// A chunk file that fails to load (a lost connection) or arrives late. tests/setup.ts has already loaded client.ts with the
// real loaders, so each test takes a fresh client.ts whose chunks.ts fails for the languages in `failing` and waits for the
// release of those in `held`.
const failing = new Set<string>()
const held = new Map<string, Promise<void>>()

/** Holds the chunk files of `lang` until the returned function is called. */
function hold(lang: string): () => void {
  let release!: () => void
  held.set(lang, new Promise<void>(resolve => { release = resolve }))
  return release
}
const KEY = 'modules.advisor.use.title'

async function freshClient() {
  vi.resetModules()
  vi.doMock('../../src/i18n/chunks', async () => {
    const real = await vi.importActual<typeof import('../../src/i18n/chunks')>('../../src/i18n/chunks')
    return {
      ...real,
      loadChunkMessages: (...args: Parameters<typeof real.loadChunkMessages>) =>
        failing.has(args[1])
          ? Promise.reject(new Error('offline'))
          : (held.get(args[1]) ?? Promise.resolve()).then(() => real.loadChunkMessages(...args)),
    }
  })
  return import('../../src/i18n/client')
}

afterEach(() => {
  failing.clear()
  held.clear()
  vi.doUnmock('../../src/i18n/chunks')
})

describe('loadLocaleChunk when a chunk fails to load', () => {
  it('falls back to English for the current language, and tries again next time', async () => {
    const client = await freshClient()
    await client.initClientI18n('ru-RU')
    failing.add('ru-RU')
    await client.loadLocaleChunk('advisor')
    expect(client.t(KEY)).toBe(advisorEn.modules.advisor.use.title)
    failing.clear()
    await client.loadLocaleChunk('advisor')
    expect(client.t(KEY)).toBe(advisorRu.modules.advisor.use.title)
  })

  it('rejects without the English chunk: the route error boundary shows instead of raw keys', async () => {
    const client = await freshClient()
    await client.initClientI18n('en-US')
    failing.add('en-US')
    await expect(client.loadLocaleChunk('advisor')).rejects.toThrow('offline')
  })

  it('forgets a failed English chunk, so the next ask (lazyWithChunks retries once) loads it', async () => {
    const client = await freshClient()
    await client.initClientI18n('en-US')
    failing.add('en-US')
    await expect(client.loadLocaleChunk('advisor')).rejects.toThrow('offline')
    failing.clear()
    await client.loadLocaleChunk('advisor')
    expect(client.t(KEY)).toBe(advisorEn.modules.advisor.use.title)
  })

  it('does not hold up a language switch: the failed chunk stays in English', async () => {
    const client = await freshClient()
    await client.initClientI18n('en-US')
    await client.loadLocaleChunk('advisor')
    failing.add('ru-RU')
    await client.applyFamilyLanguage('ru-RU')
    expect(client.currentLanguage()).toBe('ru-RU')
    expect(client.t('language.label')).not.toBe(client.t('language.label', { lng: 'en-US' }))
    expect(client.t(KEY)).toBe(advisorEn.modules.advisor.use.title)
  })
})

describe('overlapping language switches', () => {
  it('the latest switch wins, even when an older one finishes later', async () => {
    const client = await freshClient()
    await client.initClientI18n('en-US')
    await client.loadLocaleChunk('advisor')
    const release = hold('ru-RU')
    const toRussian = client.applyFamilyLanguage('ru-RU') // waits for the Russian chunk
    await client.applyFamilyLanguage('en-US')
    release()
    await toRussian
    expect(client.currentLanguage()).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')
  })

  it('a chunk asked for during the newer switch is loaded for its language', async () => {
    const client = await freshClient()
    await client.initClientI18n('en-US')
    const release = hold('ru-RU')
    const toRussian = client.applyFamilyLanguage('ru-RU')
    const toEnglish = client.applyFamilyLanguage('en-US')
    await client.loadLocaleChunk('advisor')
    await toEnglish
    release()
    await toRussian
    expect(client.currentLanguage()).toBe('en-US')
    expect(client.t(KEY)).toBe(advisorEn.modules.advisor.use.title)
  })
})
