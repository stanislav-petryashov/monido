/** The custom properties a stylesheet declares (`--x:` at a line start), once each, in order: the catalog's token list */
export function tokenNames(css: string): string[] {
  return [...new Set([...css.matchAll(/^\s*(--[A-Za-z0-9_-]+)\s*:/gm)].map(m => m[1]))]
}

/** A family is its exact prefix: `--r-` is a radius, `--rule` a colour */
const FAMILIES: { title: string; test: (name: string) => boolean }[] = [
  { title: 'Channels', test: n => n.endsWith('-ch') },
  { title: 'Spacing', test: n => n.startsWith('--sp-') || n === '--card-pad' },
  { title: 'Radii', test: n => n.startsWith('--r-') },
  { title: 'Type', test: n => n.startsWith('--fs-') || n === '--font' },
  { title: 'Shadows', test: n => n.startsWith('--shadow') },
]

/** The tokens in groups for the catalog: every name in exactly one, the colours being all the others; empty groups dropped */
export function tokenGroups(names: string[]): { title: string; names: string[] }[] {
  const family = (n: string) => FAMILIES.find(f => f.test(n))?.title ?? 'Colours'
  return ['Colours', ...FAMILIES.map(f => f.title)]
    .map(title => ({ title, names: names.filter(n => family(n) === title) }))
    .filter(g => g.names.length > 0)
}
