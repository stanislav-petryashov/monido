// Replaces the local demo data: npm run db:seed -- --reset-demo (DATA_DIR, default data-dev)
// Writes the fictional family into DATA_DIR/finance.sqlite after validating the current schema.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildFamily, familyCurrency, type DemoFamilyKey } from '../src/demo/family'
import { writeFamily } from '../src/server/demo/writeFamily'
import { openDatabase } from '../src/server/db'
import { initializeSchema } from '../src/server/schema'

const FAMILIES: readonly DemoFamilyKey[] = ['en-US', 'ru-RU']

function main(): void {
  // By default the development database (data-dev, as in npm run dev): a demo reset must not touch real data. The
  // Docker database lives in the named volume `data` (mounted at /data), out of this script's reach; a running Docker
  // install is filled through Settings → Data → Danger zone → "Load test data".
  const dataDir = resolve(process.env.DATA_DIR || 'data-dev')
  if (!process.argv.includes('--reset-demo')) {
    console.error(`This deletes all financial data in ${dataDir}. To reset the local demo: npm run db:seed -- --reset-demo`)
    process.exit(1)
  }
  const at = process.argv.indexOf('--family')
  const family = at === -1 ? 'en-US' : process.argv[at + 1]
  if (!FAMILIES.includes(family as DemoFamilyKey)) {
    console.error(`Unknown family ${family ?? '(missing)'}. Use --family ${FAMILIES.join(' or --family ')} (default en-US).`)
    process.exit(1)
  }
  const file = join(dataDir, 'finance.sqlite')
  if (!existsSync(file)) {
    console.error(`No database at ${file}. Start the server once (npm run dev) so it creates the database in ${dataDir}.`)
    process.exit(1)
  }
  try {
    const handle = openDatabase(file)
    try {
      initializeSchema(handle, resolve(process.env.SCHEMA_FILE || 'schema.sql'))
      const db = handle.sqlite
      const data = buildFamily({ family: family as DemoFamilyKey })
      const currency = familyCurrency(data)
      writeFamily(db, data)
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('language', ?), ('currency', ?)").run(family, currency)
    } finally {
      handle.close()
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
  console.log(`Demo data (${family} family) written to ${file}`)
  console.log('✓ Local demo seed complete')
}

main()
