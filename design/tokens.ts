/** The custom properties a stylesheet declares (`--x:` at a line start), once each, in order: the catalog's token list */
export function tokenNames(css: string): string[] {
  return [...new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(m => m[1]))]
}
