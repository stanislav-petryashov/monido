const MAX_TICKS = 5

/** Float noise off: 0.1 * 3 → 0.3 */
const clean = (v: number) => Math.round(v * 1e9) / 1e9

/**
 * Round scale ticks (steps 1, 2, 2.5, 5 × 10ⁿ) that cover [min, max]: the first tick is ≤ min,
 * the last is > max, and there are at most `count` of them (5 by default). A flat range is padded by 10% (±1 at zero).
 */
export function niceTicks(min: number, max: number, count = MAX_TICKS): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  let lo = Math.min(min, max)
  let hi = Math.max(min, max)
  if (lo === hi) {
    // a flat range: give it room, so the value sits inside the scale and the ticks differ
    const pad = Math.abs(lo) * 0.1 || 1
    lo -= pad
    hi += pad
  }
  const exp0 = Math.floor(Math.log10(hi - lo)) - 2
  for (let exp = exp0; ; exp++) {
    const base = 10 ** exp
    // 2.5 only above whole numbers: no 0.25-style steps that print as clutter
    const steps = exp >= 1 ? [1, 2, 2.5, 5] : [1, 2, 5]
    for (const k of steps) {
      const step = k * base
      const first = Math.floor(lo / step + 1e-9)
      const last = Math.floor(hi / step + 1e-9) + 1
      if (last - first + 1 <= count) {
        return Array.from({ length: last - first + 1 }, (_, i) => clean((first + i) * step))
      }
    }
  }
}

/** A grid step of 1, 2, 2.5 or 5 × 10ⁿ with the requested approximate number of intervals up to `hi` */
export function niceStep(hi: number, divisions = 4.5): number {
  const raw = hi / divisions
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= raw) ?? 10 * mag
}
