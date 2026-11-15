import { useState } from 'react'
import { recordFromHash } from '../../lib/recordLink'

/**
 * Which record of a records screen is chosen, by key: the user's own pick wins, then the record the address names
 * (`#<key>`, read once, dropped at the first choice of the user's own), else the first one.
 * With an initial-link resolver, an explicit unresolved link selects nothing once the list settles.
 * A pick that is not in `keys` is kept while the list is still being read (`settled` false: a record just added is
 * picked before the re-read brings it) and given up once the list has answered without it (a rename that half failed,
 * a deletion made elsewhere): the selection then falls back like an empty one.
 */
export function useRecordSelection(keys: readonly string[], settled: boolean, resolveInitialLink?: (key: string) => string | null) {
  const [picked, setPicked] = useState<string | null>(null)
  const [linked, setLinked] = useState(recordFromHash)
  const pickHolds = picked !== null && (keys.includes(picked) || !settled)
  const linkedKey = linked === null ? null : resolveInitialLink ? resolveInitialLink(linked) : linked
  const linkedHolds = linkedKey !== null && keys.includes(linkedKey)
  const unresolved = resolveInitialLink && linked !== null && settled
  const selected = pickHolds ? picked : linkedHolds ? linkedKey : unresolved ? null : keys[0] ?? null
  return {
    selected,
    /** Selects a record (one just written, or an edited one); the address's link stays as it was */
    pick: (key: string) => setPicked(key),
    /** The user chose a record in the list: the address's link is dropped */
    choose: (key: string) => { setPicked(key); setLinked(null) },
    /** The chosen record is gone: back to the address's record or the first one, and the address is dropped */
    clear: () => { setPicked(null); setLinked(null) },
  }
}
