// `npm run size`: the gzip size of each bundle scenario of .size-limit.mjs (built from dist/client's Vite manifest, with
// its guards) against its cap; exit 1 when one is over. Run after `npm run build`.
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import scenarios from '../.size-limit.mjs'

const kB = bytes => `${(bytes / 1000).toFixed(2)} kB`
/** '187 kB' → bytes (size-limit's units: 1 kB = 1000 bytes) */
const capOf = limit => {
  const m = /^(\d+(?:\.\d+)?) kB$/.exec(limit)
  if (!m) throw new Error(`size: a limit in kB, not ${JSON.stringify(limit)}`)
  return Number(m[1]) * 1000
}

let over = false
for (const { name, path, limit } of scenarios) {
  // each file compressed on its own, as the browser downloads them
  const size = path.reduce((sum, file) => sum + gzipSync(readFileSync(file), { level: 9 }).length, 0)
  const cap = capOf(limit)
  if (size > cap) over = true
  console.log(`\n  ${size > cap ? '✖' : '✔'} ${name}\n  Size limit: ${limit}\n  Size:       ${kB(size)} gzipped (${path.length} files)${size > cap ? `\n  Over by:    ${kB(size - cap)}` : ''}`)
}
console.log('')
process.exit(over ? 1 : 0)
