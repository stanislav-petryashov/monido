import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HEALTH_KEYS, zoneOf, zoneThresholds } from '../../src/domain/health'
import type { HealthKey, Zone } from '../../src/domain/types'

const doc = readFileSync(join(__dirname, '../../docs/finance-rules.md'), 'utf8')

/** The zone tables: a header whose first cell starts with a metric key in backticks, then its value and zone cells by row. */
function zoneTables(markdown: string): Map<string, { value: string; zone: string }[]> {
  const tables = new Map<string, { value: string; zone: string }[]>()
  const lines = markdown.split('\n')
  lines.forEach((line, i) => {
    const key = line.match(/^\| `([a-z_]+)`/)?.[1]
    if (!key) return
    const rows: { value: string; zone: string }[] = []
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
      const [value, zone] = lines[j].split('|').slice(1).map(c => c.trim())
      rows.push({ value, zone })
    }
    tables.set(key, rows)
  })
  return tables
}

const ZONE_NAMES: Record<Zone, string> = { red: 'Critical', amber: 'Needs work', green: 'Good', excellent: 'Excellent' }
const EPS = 1e-9

/**
 * The value cells a metric's zones read as, lowest values first: each border's side and each zone come from zoneOf
 * probed on the border and a hair either side of it, not from the metric's direction.
 */
function expectedRows(key: HealthKey): { value: string; zone: string }[] {
  const [a, b, c] = zoneThresholds(key)
  /** The border value falls in the zone below it */
  const lowerHolds = (t: number) => zoneOf(key, t) === zoneOf(key, t - EPS)
  const upTo = (t: number) => (lowerHolds(t) ? '≤' : '<')
  const from = (t: number) => (lowerHolds(t) ? '<' : '≤')
  const zone = (v: number) => ZONE_NAMES[zoneOf(key, v)]
  return [
    { value: `${upTo(a)} ${a}`, zone: zone(a - EPS) },
    { value: `${a} ${from(a)} x ${upTo(b)} ${b}`, zone: zone(b - EPS) },
    { value: `${b} ${from(b)} x ${upTo(c)} ${c}`, zone: zone(c - EPS) },
    { value: `${lowerHolds(c) ? '>' : '≥'} ${c}`, zone: zone(c + EPS) },
  ]
}

describe('docs/finance-rules.md zone tables', () => {
  const tables = zoneTables(doc)

  it('has one zone table per health metric and no other', () => {
    expect([...tables.keys()].sort()).toEqual([...HEALTH_KEYS].sort())
  })

  it.each(HEALTH_KEYS)('%s: the borders and zones are the domain ZONES', key => {
    const rows = (tables.get(key) ?? []).map(r => ({ value: r.value, zone: r.zone.replace(/^\S+ /, '').split(' — ')[0] }))
    expect(rows).toEqual(expectedRows(key))
  })
})
