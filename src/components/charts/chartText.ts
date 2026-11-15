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
