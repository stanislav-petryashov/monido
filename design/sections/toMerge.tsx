// The duplicate groups side by side, each member pointing at the entry it is to merge into (tests/styles/
// duplicateRatchet.test.ts freezes the same classes, and labels it does not watch are listed too). A merge PR moves a
// group onto its canonical, renames it neutrally where it is page-named, and removes its members here. Data only.
import type { ReactNode } from 'react'
import { KpiCell } from '../../src/components/cards/KpiCell'
import { RecordKpis } from '../../src/components/cards/RecordKpis'
import type { DesignEntry } from '../registry'

const MONEY = '$14,093'
const tableOf = (cls: string) => <table className={cls}><tbody><tr><td>Savings</td><td className="num">$12,400</td></tr><tr><td>Checking</td><td className="num">$3,180</td></tr></tbody></table>

/** How a member of each kind is drawn: the same content in each class, so the difference shows */
const SAMPLE: Record<string, (cls: string) => ReactNode> = {
  link: cls => <a className={cls} href="#to-merge">What changed our net worth</a>,
  title: cls => <h2 className={cls}>Assets</h2>,
  value: cls => <strong className={`${cls} num`}>$684,196</strong>,
  label: cls => <div><span className={cls}>Net worth</span><div className="num">$684,196</div></div>,
  cfKpi: () => <ul className="cf-kpis"><li className="cf-kpi"><span className="cf-kpi__label">Came in</span><strong className="cf-kpi__value num">{MONEY}</strong><span className="cf-kpi__meta">usual: $13,800</span></li></ul>,
  glKpi: () => <dl className="gl-kpis"><div className="gl-kpi"><dt className="gl-kpi__l">Saved</dt><dd className="gl-kpi__v num">{MONEY}</dd><dd className="gl-kpi__m">of $20,000</dd></div></dl>,
  accKpi: () => <RecordKpis label="Account figures" cells={[{ key: 'b', label: 'Balance', value: MONEY, meta: 'September 2026' }]} />,
}

const KPI = 'KPI cell (to decide)'
const LABEL = 'Label above a figure (to decide)'
/** member class, its sample, the canonical entry, the owner stylesheet */
const MEMBERS: [string, keyof typeof SAMPLE, string, string][] = [
  ['.nw__value', 'value', '.hl__value', 'src/styles/overview.css'],
  ['.acc-kpi', 'accKpi', KPI, 'src/styles/accounts.css'],
  ['.cf-kpi', 'cfKpi', KPI, 'src/styles/cashflow.css'],
  ['.gl-kpi', 'glKpi', KPI, 'src/styles/goals.css'],
  ['.acc-kpi__l', 'label', LABEL, 'src/styles/accounts.css'],
  ['.avail-hero__label', 'label', LABEL, 'src/styles/availability.css'],
  ['.gl-kpi__l', 'label', LABEL, 'src/styles/goals.css'],
  ['.nw__label', 'label', LABEL, 'src/styles/overview.css'],
  ['.kpi__label', 'label', LABEL, 'src/styles/overview.css'],
  ['.hl__label', 'label', LABEL, 'src/styles/tokens.css'],
  ['.cf-kpi__label', 'label', LABEL, 'src/styles/cashflow.css'],
  ['.close-progress__label', 'label', LABEL, 'src/styles/admin.css'],
  ['.assets-period__label', 'label', LABEL, 'src/styles/assets.css'],
  ['.close-problems__link', 'link', '.title-row__link', 'src/styles/admin.css'],
  ['.comb__year-link', 'link', '.title-row__link', 'src/styles/overview.css'],
  ['.overview-section-title', 'title', 'SectionLabel', 'src/styles/overview.css'],
]

export const TO_MERGE_ENTRIES: DesignEntry[] = MEMBERS.map(([name, kind, canonical, owner]) => ({
  name, use: `A duplicate: merge into ${canonical}.`, kind: 'css', owner, duplicateOf: canonical,
  variants: [{ label: name, render: () => SAMPLE[kind](name.slice(1)) }],
}))

/** Canonicals that exist only as the target of a group, and the two groups whose canonical a merge PR still decides */
export const CANONICAL_ENTRIES: DesignEntry[] = [
  { name: KPI, use: 'The KPI cell: KpiCell (a li of ul.kpis) or RecordKpis (a dl); the merge PR picks one, the markup differs.', kind: 'pattern', owner: 'src/styles/overview.css', variants: [
    { label: 'KpiCell', render: () => <ul className="kpis"><KpiCell label="Came in" value={MONEY} delta="usual: $13,800" /></ul> },
    { label: 'RecordKpis', render: () => <RecordKpis label="Account figures" cells={[{ key: 'b', label: 'Came in', value: MONEY, meta: 'usual: $13,800' }]} /> },
  ] },
  { name: LABEL, use: 'The label above a figure: one neutral class (proposed .figure-label) replaces the page-named ones in the merge PR.', kind: 'pattern', owner: 'src/styles/tokens.css', variants: [
    { label: 'the look they share', render: () => SAMPLE.label('hl__label') },
  ] },
  { name: '.admin-table', use: 'An entry table on a Records screen (dense, editable, in .admin-table-scroll); the canonical entry variant of the table.', kind: 'css', owner: 'src/styles/admin.css', variants: [
    { label: 'default', render: () => <div className="admin-table-scroll">{tableOf('admin-table')}</div> },
  ] },
  { name: '.link-button', use: 'An action that reads as a link (a button styled as text); the one link-styled button, never a page copy.', kind: 'css', owner: 'src/styles/tokens.css', variants: [
    { label: 'default', render: () => <button type="button" className="link-button">Edit the goal</button> },
  ] },
  { name: '.title-row__link', use: 'A quiet underlined link in ink: the proposed canonical of the quiet links, to get a neutral name in an owner stylesheet.', kind: 'css', owner: 'src/styles/shell.css', variants: [
    { label: 'default', render: () => <a className="title-row__link" href="#to-merge">2025</a> },
  ] },
]
