/** Wrap captions in 12-unit text, retaining every character, including money and dates. */
export function wrapChartText(text: string, width: number): string[] {
  // An em-wide bound also fits wide localized capitals and currency symbols.
  const limit = Math.max(1, Math.floor(width / 12)), lines: string[] = []
  let rest = text
  while (rest.length > limit) {
    const space = rest.lastIndexOf(' ', limit - 1)
    const end = space > 0 ? space + 1 : limit
    lines.push(rest.slice(0, end))
    rest = rest.slice(end)
  }
  return [...lines, rest]
}

/** The width of `text` in 12-unit chart text: 0.62 em a character, wide enough for Onest digits and long localized months. */
export const textWidth = (text: string): number => text.length * 12 * 0.62

export interface AxisLabel { x: number; text: string; anchor: 'start' | 'middle' | 'end' }

/**
 * The axis labels that fit side by side in 12-unit text: the edge labels first (the first and the last), then the rest
 * in order; one that would come within `gap` of a placed label is dropped; widths by `textWidth` ("Sept. '25", "août '28").
 */
export function fitAxisLabels<T extends AxisLabel>(labels: T[], gap = 8): T[] {
  const span = (l: AxisLabel): [number, number] => {
    const w = textWidth(l.text)
    return l.anchor === 'start' ? [l.x, l.x + w] : l.anchor === 'end' ? [l.x - w, l.x] : [l.x - w / 2, l.x + w / 2]
  }
  const order = labels.map((_, i) => i).sort((a, b) => Number(b === 0 || b === labels.length - 1) - Number(a === 0 || a === labels.length - 1))
  const placed: [number, number][] = [], kept = new Set<number>()
  for (const i of order) {
    const [a, b] = span(labels[i])
    if (placed.some(([c, d]) => a < d + gap && b > c - gap)) continue
    placed.push([a, b])
    kept.add(i)
  }
  return labels.filter((_, i) => kept.has(i))
}
