import axe from 'axe-core'

const RULES = {
  // jsdom has no layout or computed colours, so contrast cannot be measured here (tests/styles/ checks the tokens)
  'color-contrast': { enabled: false },
}

/**
 * The axe-core violations in `root` (the whole document by default) as readable lines: rule, impact, the offending
 * nodes. `skip` turns off a rule for one check; each skipped rule names its reason at the call.
 */
export async function axeViolations(root: Element | Document = document, skip: string[] = []): Promise<string[]> {
  const rules = { ...RULES, ...Object.fromEntries(skip.map(id => [id, { enabled: false }])) }
  const { violations } = await axe.run(root, { rules, resultTypes: ['violations'] })
  return violations.flatMap(v => v.nodes.map(n => `${v.id} (${v.impact}): ${v.help} at ${n.target.join(' ')}: ${n.html.slice(0, 160)}`))
}
