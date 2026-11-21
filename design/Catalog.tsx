import copy from './locales/ru-RU.json'
// The catalog's sections: the tokens read live from the stylesheet (so the theme switch changes them), then every
// registry entry with its variants. Components only (react-refresh).
import { useState, useSyncExternalStore } from 'react'
import { SegmentedPills } from '../src/components/ui/SegmentedPills'
import { directory, relatedEntries } from './directory'
import { CodeDialog } from './CodeDialog'
import tokensCss from '../src/styles/tokens.css?raw'
import { ENTRIES, type DesignEntry } from './registry'
import { tokenGroups, tokenNames, tokenNotes } from './tokens'

// the value is read on each render: the theme switch re-renders the rows (the `theme` key), and the dark theme redefines the colours
function TokenRow({ name, note }: { name: string; note: string | undefined }) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const swatch = name.startsWith('--sp-') || name === '--card-pad' ? { width: `var(${name})`, height: 'var(--sp-2)' } : { background: name.endsWith('-ch') ? `rgb(var(${name}))` : `var(${name})` }
  return <tr className="dc__token"><td><code>{name}</code></td><td>{value}</td><td>
    {name.startsWith('--fs-') ? <span style={{ fontSize: `var(${name})` }}>Aa</span> : name.startsWith('--r-') ? <i className="dc__swatch" style={{ borderRadius: `var(${name})` }} /> : name.startsWith('--shadow') ? <i className="dc__swatch" style={{ boxShadow: `var(${name})` }} /> : <i className="dc__swatch" style={swatch} />}
    </td><td>
    {note && <span className="note note--help dc__token-note">{note}</span>}
  </td></tr>
}

/** The theme the document shows (`data-theme` on <html>), followed as it changes: the values are read after it */
function subscribeTheme(change: () => void) {
  const observer = new MutationObserver(change)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}
const shownTheme = () => document.documentElement.dataset.theme ?? ''

function Tokens() {
  const theme = useSyncExternalStore(subscribeTheme, shownTheme)
  const names = tokenNames(tokensCss)
  const notes = tokenNotes(tokensCss)
  const [family, setFamily] = useState('Spacing')
  const families = tokenGroups(names)
  const labels: Record<string, string> = { Colours: copy.colours, Channels: copy.channels, Spacing: copy.spacing, Radii: copy.radii, Type: copy.type, Shadows: copy.shadows }
  return <section><h2>{copy.tokens}</h2>
    <label>{copy.group} <select value={family} onChange={e => setFamily(e.target.value)}>
      {families.map(g => <option key={g.title} value={g.title}>{labels[g.title]}</option>)}
    </select></label>
    <div className="dc-scroll" tabIndex={0} role="region" aria-label={copy.tokenTable}><table><thead><tr>
      <th>{copy.variable}</th><th>{copy.value}</th><th>{copy.sample}</th><th>{copy.usage}</th>
    </tr></thead><tbody>{families.find(g => g.title === family)?.names.map(n =>
      <TokenRow key={theme + n} name={n} note={notes[n]} />)}</tbody></table></div>
  </section>
}

function entryId(name: string) { return 'e-' + name.replace(/\W/g, '') }

function subscribeHash(change: () => void) {
  window.addEventListener('hashchange', change)
  return () => window.removeEventListener('hashchange', change)
}
const readHash = () => window.location.hash.slice(1)
const summaries: Record<string, string> = {
  AppNavigation: copy.navigationUsage,
  CloseOwnerGroup: copy.closeOwnerGroupUsage,
  Switch: copy.switchUsage,
  '.btn': copy.buttonUsage,
  Chip: copy.chipUsage,
}
const names = Object.assign({}, ...Object.values(directory)) as Record<string, string>
const widths = { phone: 390, tablet: 768, desktop: 1440 }
type Device = keyof typeof widths
const devices: Device[] = ['phone', 'tablet', 'desktop']
const legacySections: Record<string, string> = { components: 'Switch', css: '.btn' }

function Entry({ entry, language, settingsKey, device, setDevice }: {
  entry: DesignEntry; language: string; settingsKey: string; device: Device; setDevice: (v: Device) => void
}) {
  const [showCode, setShowCode] = useState(false)
  const related = Object.keys(relatedEntries).filter(name => relatedEntries[name] === entry.name)
  const recommended = entry.duplicateOf ?? relatedEntries[entry.name]
  const title = names[entry.name] ?? entry.name
  return <article>
    <div className="dc__heading"><h2>{title}</h2><button className="btn btn--ghost" onClick={() => setShowCode(true)}>{copy.code}</button></div>
    {title !== entry.name && <code>{entry.name}</code>}
    <p className="dc__use">{summaries[entry.name] ?? entry.use}</p>
    {recommended && <p>{entry.duplicateOf ? copy.useInstead : copy.parentElement} <a href={'#' + entryId(recommended)}>{recommended}</a></p>}
    {related.length > 0 && <p>{copy.relatedElements} {related.map((name, i) => <span key={name}>{i > 0 && ', '}<a href={'#' + entryId(name)}>{name}</a></span>)}</p>}
    {showCode && <CodeDialog entry={entry} onClose={() => setShowCode(false)} />}
    {entry.variants.length > 0 && <section className="dc-stage">
      <div className="dc-tools"><h3>{copy.preview}</h3><SegmentedPills items={devices} active={device} onSelect={setDevice} label={value => copy[value]} ariaLabel={copy.viewportWidth} />
        <output>{widths[device]} px</output></div>
      <div tabIndex={0} role="region" aria-label={copy.liveSample} className="dc-scroll"><iframe
        key={settingsKey} title={title} width={widths[device]} src={'?'+new URLSearchParams({ sample: entry.name, lang: language })} /></div>
    </section>}
  </article>
}

export function Catalog({ language = 'ru-RU', settingsKey = '' }: { language?: string; settingsKey?: string }) {
  const hash = useSyncExternalStore(subscribeHash, readHash)
  const [device, setDevice] = useState<Device>(() => innerWidth <= 640 ? 'phone' : innerWidth < 1200 ? 'tablet' : 'desktop')
  const [menu, setMenu] = useState(false)
  const entry = ENTRIES.find(e => entryId(e.name) === hash || 'e-' + e.name === hash || e.name === legacySections[hash])
    ?? (hash === 'patterns' ? ENTRIES.find(e => e.kind === 'pattern') : undefined) ?? ENTRIES.find(e => e.name === 'Switch')!
  const active = relatedEntries[entry.name] ?? entry.name
  const group = Object.keys(directory).find(key => active in directory[key])
  const tokens = hash === 'tokens'
  const duplicates = hash === 'to-merge'
  const title = tokens ? copy.tokens : duplicates ? copy.duplicates : names[entry.name] ?? entry.name
  return <div className="dc__layout"><aside>
    <button className="dc-menu btn btn--ghost" aria-expanded={menu} aria-controls="dc-nav" onClick={() => setMenu(!menu)}>{copy.contents} · {title}</button>
    <nav id="dc-nav" className={menu ? 'dc-nav expanded' : 'dc-nav'} aria-label={copy.contents}>
      <h2>{copy.elements}</h2>
      {Object.entries(directory).map(([section, items]) => <details key={section + hash} open={!tokens && !duplicates && group === section}>
        <summary>{section}</summary>{Object.entries(items).map(([name, label]) =>
          <a key={name} href={'#' + entryId(name)} aria-current={!tokens && !duplicates && active === name ? 'page' : undefined} onClick={() => setMenu(false)}>
            {label}<code>{name}</code></a>)}</details>)}
      <a className="dc-tokens-link" href="#tokens" onClick={() => setMenu(false)} aria-current={tokens ? 'page' : undefined}>{copy.tokens}</a>
      {ENTRIES.some(e => e.duplicateOf) && <a href="#to-merge" onClick={() => setMenu(false)}>{copy.duplicates}</a>}
    </nav></aside>
    <main className="dc__content">{tokens ? <Tokens /> : duplicates ? <ToMerge /> : <>
      <p className="dc-path">{group}</p><Entry key={entry.name} entry={entry} language={language} settingsKey={settingsKey} device={device} setDevice={setDevice}/>
    </>}</main></div>
}

/** Each duplicate group: its canonical entry first, then the members to merge into it */
function ToMerge() {
  const groups = new Map<string, DesignEntry[]>()
  for (const e of ENTRIES) if (e.duplicateOf) groups.set(e.duplicateOf, [...(groups.get(e.duplicateOf) ?? []), e])
  return <section id="to-merge" className="dc__section"><h2>{copy.duplicates}</h2>
    <p className="note">{copy.duplicatesHelp}</p>
    {groups.size === 0 && <p className="note">{copy.noDuplicates}</p>}
    {[...groups].map(([canonical, members]) => <div key={canonical} className="dc__group">
      <h3>Into <code>{canonical}</code></h3>
      <div className="dc__variants">
        {[ENTRIES.find(e => e.name === canonical)!, ...members].map(e => <figure key={e.name} className="dc__variant"><div>{e.variants[0]?.render() ?? <span className="note">see its entry</span>}</div><figcaption className="note"><a href={'#' + entryId(e.name)}>{e.name}</a></figcaption></figure>)}
      </div>
    </div>)}
  </section>
}
