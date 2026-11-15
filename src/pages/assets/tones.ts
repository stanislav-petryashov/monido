import { accountKey } from '../../domain/accounts'
import type { HoldingChange } from '../../domain/assetChanges'

/** Each type's tones (assets.css `.asset-tone--*`), the base one first: a type's largest holding takes it, smaller ones the lighter tones */
export const TONES = { real_estate: ['re', 're-2'], broker: ['br', 'br-2', 'br-3'], bank: ['bk', 'bk-2', 'bk-3'], other: ['ot'] } as const
/** The order the types take on the page */
export const TYPES = ['real_estate', 'broker', 'bank', 'other'] as const

export const holdingKey = (h: Pick<HoldingChange, 'kind' | 'name' | 'member'>) => h.kind + accountKey(h.name, h.member)

/**
 * The tone of each holding, the same on the map, the waterfall and the holdings list: its rank by value within its
 * type, the last tone repeating; a holding closed during the period (no value) takes its type's lightest.
 */
export function holdingTones(holdings: Pick<HoldingChange, 'kind' | 'name' | 'member' | 'type' | 'valueBase'>[]): (h: Pick<HoldingChange, 'kind' | 'name' | 'member' | 'type'>) => string {
  const tones = new Map<string, string>()
  for (const type of TYPES) {
    holdings.filter(h => h.type === type).sort((a, b) => b.valueBase - a.valueBase)
      .forEach((h, rank) => tones.set(holdingKey(h), TONES[type][Math.min(rank, TONES[type].length - 1)]))
  }
  return h => tones.get(holdingKey(h)) ?? TONES[h.type][0]
}
