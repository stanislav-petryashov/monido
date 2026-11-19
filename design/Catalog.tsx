// The catalog's sections: the tokens read live from the stylesheet (so the theme switch changes them), then every
// registry entry with its variants. Components only (react-refresh).
import { useSyncExternalStore } from 'react'
import tokensCss from '../src/styles/tokens.css?raw'
import { ENTRIES, type DesignEntry } from './registry'
import { tokenGroups, tokenNames } from './tokens'

// the value is read on each render: the theme switch re-renders the rows (the `theme` key), and the dark theme redefines the colours
function TokenRow({ name }: { name: string }) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const swatch = name.startsWith('--sp-') || name === '--card-pad' ? { width: `var(${name})`, height: 'var(--sp-2)' } : { background: name.endsWith('-ch') ? `rgb(var(${name}))` : `var(${name})` }
  return <li className="dc__token">
    {name.startsWith('--fs-') ? <span style={{ fontSize: `var(${name})` }}>Aa</span> : name.startsWith('--r-') ? <i className="dc__swatch" style={{ borderRadius: `var(${name})` }} /> : name.startsWith('--shadow') ? <i className="dc__swatch" style={{ boxShadow: `var(${name})` }} /> : <i className="dc__swatch" style={swatch} />}
    <code>{name}</code><span className="note">{value}</span>
  </li>
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
  return <section id="tokens" className="dc__section"><h2>Tokens</h2>
    {tokenGroups(names).map(g => <div key={g.title}><h3>{g.title}</h3><ul className="dc__tokens">{g.names.map(n => <TokenRow key={`${theme}-${n}`} name={n} />)}</ul></div>)}
  </section>
}

function Entry({ entry }: { entry: DesignEntry }) {
  return <article className="dc__entry" id={`e-${entry.name.replace(/\W/g, '')}`}>
    <h3><code>{entry.name}</code>{entry.duplicateOf && <span className="note"> to merge into {entry.duplicateOf}</span>}</h3>
    <p className="note">{entry.use}</p>
    <p className="note">{entry.from ?? entry.owner}</p>
    <div className="dc__variants">{entry.variants.map(v => <figure key={v.label} className="dc__variant"><div>{v.render()}</div><figcaption className="note">{v.label}</figcaption></figure>)}</div>
  </article>
}

const SECTIONS: { id: string; title: string; kind: DesignEntry['kind'] }[] = [
  { id: 'components', title: 'Components', kind: 'component' },
  { id: 'css', title: 'CSS primitives', kind: 'css' },
  { id: 'patterns', title: 'Patterns', kind: 'pattern' },
]

export function Catalog() {
  const sections = SECTIONS.filter(s => ENTRIES.some(e => e.kind === s.kind && !e.duplicateOf))
  return <>
    <nav className="dc__index" aria-label="Sections"><a href="#tokens">Tokens</a>{sections.map(s => <a key={s.id} href={`#${s.id}`}>{s.title}</a>)}</nav>
    <Tokens />
    {sections.map(s => <section key={s.id} id={s.id} className="dc__section"><h2>{s.title}</h2>
      {ENTRIES.filter(e => e.kind === s.kind && !e.duplicateOf).map(e => <Entry key={e.name} entry={e} />)}
    </section>)}
  </>
}
