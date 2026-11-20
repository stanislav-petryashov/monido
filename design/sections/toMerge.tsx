// The duplicate groups side by side, each member pointing at the entry it is to merge into (tests/styles/
// duplicateRatchet.test.ts freezes the same classes). All the groups the catalog found were merged by 2026-11-20; a
// newly found group is listed here until its merge PR. Data only.
import type { DesignEntry } from '../registry'
import { Amounts } from '../samples'

const tableOf = (cls: string) => <Amounts>{a => <table className={cls}><tbody><tr><td>Savings</td><td className="num">{a('$12,400')}</td></tr><tr><td>Checking</td><td className="num">{a('$3,180')}</td></tr></tbody></table>}</Amounts>

export const TO_MERGE_ENTRIES: DesignEntry[] = []

/** Canonicals that have no other entry */
export const CANONICAL_ENTRIES: DesignEntry[] = [
  { name: '.admin-table', use: 'An entry table on a Records screen (dense, editable, in .admin-table-scroll); the entry variant of the table, beside the reading .page-table.', kind: 'css', owner: 'src/styles/admin.css', variants: [
    { label: 'default', render: () => <div className="admin-table-scroll">{tableOf('admin-table')}</div> },
  ] },
  { name: '.link-button', use: 'An action that reads as a link (a button styled as text); the one link-styled button, never a page copy.', kind: 'css', owner: 'src/styles/tokens.css', variants: [
    { label: 'default', render: () => <button type="button" className="link-button">Edit the goal</button> },
  ] },
]
