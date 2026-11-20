// The components of src/components/cards, src/pages/admin/ui, src/components/charts and src/components/finance. Data
// only (react-refresh); the stateful ones go through design/samples.tsx.
import { KpiCell } from '../../src/components/cards/KpiCell'
import { MetricExplainer } from '../../src/components/cards/MetricExplainer'
import { RecordKpis } from '../../src/components/cards/RecordKpis'
import { StatRow } from '../../src/components/cards/StatRow'
import { StatusCard, ZoneChip } from '../../src/components/cards/StatusCard'
import { ZoneBar } from '../../src/components/cards/ZoneBar'
import { CapitalHistoryPanel } from '../../src/components/charts/CapitalHistoryPanel'
import { ThemedChart } from '../../src/components/charts/ThemedChart'
import { WaterfallSvg } from '../../src/components/charts/WaterfallSvg'
import { AllocationMeter } from '../../src/components/finance/AllocationMeter'
import { AvailabilityPanel } from '../../src/components/finance/AvailabilityPanel'
import ClosedMonthResult from '../../src/components/finance/ClosedMonthResult'
import { FinancialAnswers } from '../../src/components/finance/FinancialAnswers'
import { ForecastPanel } from '../../src/components/finance/ForecastPanel'
import { QuestionAnswer, QuestionPanel } from '../../src/components/finance/QuestionPanel'
import { initialCapitalHistoryState } from '../../src/lib/capitalHistory'
import { AdminReadNotice } from '../../src/pages/admin/ui/AdminReadNotice'
import { AmountInput } from '../../src/pages/admin/ui/AmountInput'
import { CurrencyCombobox } from '../../src/pages/admin/ui/CurrencyCombobox'
import { DateFormatField } from '../../src/pages/admin/ui/DateFormatField'
import { DateInput } from '../../src/pages/admin/ui/DateInput'
import { Field } from '../../src/pages/admin/ui/Field'
import { FieldError } from '../../src/pages/admin/ui/FieldError'
import { FormDialog } from '../../src/pages/admin/ui/FormDialog'
import { MonthInput } from '../../src/pages/admin/ui/MonthInput'
import { NewPasswordFields } from '../../src/pages/admin/ui/NewPasswordFields'
import { NumberInput } from '../../src/pages/admin/ui/NumberInput'
import { OptionPicker } from '../../src/pages/admin/ui/OptionPicker'
import { RowMenu } from '../../src/pages/admin/ui/RowMenu'
import { Select } from '../../src/pages/admin/ui/Select'
import { SettingsSection } from '../../src/pages/admin/ui/SettingsSection'
import { SignButton } from '../../src/pages/admin/ui/SignButton'
import { TagList } from '../../src/pages/admin/ui/TagList'
import { TermInput } from '../../src/pages/admin/ui/TermInput'
import { makeSnapshot } from '../../tests/helpers/snapshot'
import type { DesignEntry } from '../registry'
import { Amounts, FormDialogSample, Stateful } from '../samples'

const snapshot = makeSnapshot()
const lastMonth = snapshot.history.at(-1)!.date.slice(0, 7)
const cards = (f: string) => `src/components/cards/${f}`
const admin = (f: string) => `src/pages/admin/ui/${f}`
const charts = (f: string) => `src/components/charts/${f}`
const finance = (f: string) => `src/components/finance/${f}`
const T = 'src/styles/tokens.css'
const A = 'src/styles/admin.css'
const C = 'src/styles/controls.css'
const noop = () => {}
const failed = { data: null, error: new Error('The server did not answer.'), isPending: false, isFetching: false, refetch: () => Promise.resolve() }

export const MORE_ENTRIES: DesignEntry[] = [
  // cards
  { name: 'KpiCell', use: 'A cell of a page\'s KPI strip (ul.kpis: a rule over each cell, the current one violet), given one by one by the modules; a record\'s or a section\'s row of facts is RecordKpis.', kind: 'component', from: cards('KpiCell.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'with delta', render: () => <Amounts>{a => <ul className="kpis"><KpiCell label="Income" value={a('$14,093')} delta={`${a('+$220')} over the month`} /></ul>}</Amounts> },
    { label: 'current', render: () => <ul className="kpis"><KpiCell label="Emergency fund" value="10 mo" current /></ul> },
  ] },
  { name: 'RecordKpis', use: 'A row of facts (dl.kpis--facts: one rule over the row, hairlines between the cells) on a record, a goal or the cash flow page; tone colours the line under a value, bad the value; a page\'s strip is KpiCell.', kind: 'component', from: cards('RecordKpis.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'three cells', render: () => <Amounts>{a => <RecordKpis label="Account figures" cells={[{ key: 'b', label: 'Balance', value: a('$12,400'), meta: 'September 2026' }, { key: 'r', label: 'Return', value: '4.1%', meta: null }, { key: 'c', label: 'Change', value: a('+$300'), meta: 'over the month' }]} />}</Amounts> },
  ] },
  { name: 'StatRow', use: 'A label and a value on one line inside a card; not a table.', kind: 'component', from: cards('StatRow.tsx'), owner: T, variants: [
    { label: 'default', render: () => <Amounts>{a => <StatRow label="Liquid money" value={a('$15,580')} />}</Amounts> },
  ] },
  { name: 'StatusCard', use: 'A health indicator card: value, zone bar, advice; only on Financial health.', kind: 'component', from: cards('StatusCard.tsx'), owner: T, variants: [
    { label: 'green', render: () => <StatusCard label="Emergency fund" value="10 mo" zone="green" thresholds={[1, 3, 6]} inverse={false} unit="mo" advice="Enough for a lost income." /> },
    { label: 'unknown', render: () => <StatusCard label="Savings rate" value="—" zone={null} thresholds={[5, 10, 20]} inverse={false} unit="%" /> },
  ] },
  { name: 'ZoneChip', use: 'The zone of a health indicator as a status chip; not a tag.', kind: 'component', from: cards('StatusCard.tsx'), owner: T, variants:
    (['red', 'amber', 'green', 'excellent'] as const).map(zone => ({ label: zone, render: () => <ZoneChip zone={zone} /> })) },
  { name: 'ZoneBar', use: 'The thresholds of a health indicator as a bar with the value placed on it.', kind: 'component', from: cards('ZoneBar.tsx'), owner: T, variants: [
    { label: 'amber', render: () => <ZoneBar zone="amber" thresholds={[1, 3, 6]} inverse={false} unit="mo" /> },
  ] },
  { name: 'MetricExplainer', use: 'How a metric is calculated (its facts and notes) in the info popover of a card title (Goals forecasts).', kind: 'component', from: cards('MetricExplainer.tsx'), owner: T, variants: [
    { label: 'emergency fund', render: () => <MetricExplainer metric="emergency_months" facts={[{ label: 'Liquid money', value: 15580, kind: 'money' }, { label: 'Average expenses', value: 1550, kind: 'money' }]} /> },
  ] },
  // admin/ui
  { name: 'Field', use: 'Every form field: the caption, the hint, the unit and the error slot around one control.', kind: 'component', from: admin('Field.tsx'), owner: A, variants: [
    { label: 'with hint', render: () => <Field label="Account name" hint="As the bank names it."><input className="admin-input" defaultValue="Savings" /></Field> },
    { label: 'with error', render: () => <Field label="Balance" error="Enter a number."><input className="admin-input" aria-invalid="true" defaultValue="12," /></Field> },
  ] },
  { name: 'FieldError', use: 'The error line under a field (role alert); Field draws it, not by hand.', kind: 'component', from: admin('FieldError.tsx'), owner: A, variants: [
    { label: 'default', render: () => <FieldError>Enter a number.</FieldError> },
  ] },
  { name: 'AmountInput', use: 'A money amount: grouping as you type, two decimals; masked in privacy mode.', kind: 'component', from: admin('AmountInput.tsx'), owner: C, variants: [
    { label: 'filled', render: () => <Stateful initial="12400">{(v, set) => <AmountInput label="Balance" value={v} onChange={set} />}</Stateful> },
  ] },
  { name: 'NumberInput', use: 'A plain number (a rate, a share) with an optional unit; not money (AmountInput).', kind: 'component', from: admin('NumberInput.tsx'), owner: C, variants: [
    { label: 'percent', render: () => <Stateful initial="6">{(v, set) => <NumberInput label="Inflation" value={v} onChange={set} unit="%" decimals={1} />}</Stateful> },
  ] },
  { name: 'TermInput', use: 'A loan term in years or months, switchable.', kind: 'component', from: admin('TermInput.tsx'), owner: A, variants: [
    { label: 'default', render: () => <Stateful initial="60">{(v, set) => <TermInput label="Term" value={v} onChange={set} />}</Stateful> },
  ] },
  { name: 'DateInput', use: 'A date typed in the family date format, with a calendar.', kind: 'component', from: admin('DateInput.tsx'), owner: C, variants: [
    { label: 'default', render: () => <Stateful initial="2026-09-30">{(v, set) => <DateInput label="Date" value={v} onChange={set} />}</Stateful> },
  ] },
  { name: 'MonthInput', use: 'A month picked by its last day (an ISO date), typed or from its chips; not a free date (DateInput).', kind: 'component', from: admin('MonthInput.tsx'), owner: A, variants: [
    { label: 'default', render: () => <Stateful initial={`${lastMonth}-30`}>{(v, set) => <MonthInput label="Target month" value={v} onChange={set} />}</Stateful> },
  ] },
  { name: 'DateFormatField', use: 'The family date format choice in Settings, with a live example.', kind: 'component', from: admin('DateFormatField.tsx'), owner: C, variants: [
    { label: 'dmy', render: () => <DateFormatField value="dmy" onChange={noop} /> },
  ] },
  { name: 'CurrencyCombobox', use: 'Adding a currency by code or name, with suggestions; not a select of the project currencies.', kind: 'component', from: admin('CurrencyCombobox.tsx'), owner: A, variants: [
    { label: 'default', render: () => <CurrencyCombobox label="Add a currency" exclude={['USD']} onPick={noop} /> },
  ] },
  { name: 'Select', use: 'Every native dropdown (wraps .admin-select in .select); a sharedUi rule enforces it.', kind: 'component', from: admin('Select.tsx'), owner: C, variants: [
    { label: 'default', render: () => <Select aria-label="Currency" defaultValue="USD"><option>USD</option><option>EUR</option></Select> },
  ] },
  { name: 'OptionPicker', use: 'A choice among options: segmented buttons up to four, a Select beyond.', kind: 'component', from: admin('OptionPicker.tsx'), owner: A, variants: [
    { label: 'segmented', render: () => <Stateful initial="consumer">{(v, set) => <OptionPicker aria-label="Loan type" value={v} onChange={set} options={[{ value: 'consumer', label: 'Consumer' }, { value: 'mortgage', label: 'Mortgage' }]} />}</Stateful> },
  ] },
  { name: 'SignButton', use: 'The ± button of a signed amount on a touchscreen; NumberInput draws it itself, never by hand.', kind: 'component', from: admin('SignButton.tsx'), owner: A, variants: [
    { label: 'default', render: () => <SignButton value="120" onToggle={noop} /> },
  ] },
  { name: 'TagList', use: 'A reference list as removable tags with an add field (currencies, members).', kind: 'component', from: admin('TagList.tsx'), owner: A, variants: [
    { label: 'with add field', render: () => <Stateful initial="">{(v, set) => <TagList label="Members" tags={[{ key: 1, text: 'Alex' }, { key: 2, text: 'Sam', fixed: true }]} onRemove={noop} value={v} onChange={set} onAdd={noop} placeholder="Name" />}</Stateful> },
  ] },
  { name: 'NewPasswordFields', use: 'A new password and its repeat, with the rules; only for setting a password.', kind: 'component', from: admin('NewPasswordFields.tsx'), owner: C, variants: [
    { label: 'too short', render: () => <NewPasswordFields password="abc" repeat="" onPassword={noop} onRepeat={noop} problem="password_too_short" /> },
  ] },
  { name: 'RowMenu', use: 'Row actions behind "···" (edit, delete); not the page action.', kind: 'component', from: admin('RowMenu.tsx'), owner: A, variants: [
    { label: 'default', render: () => <RowMenu label="Savings" items={[{ label: 'Edit', onSelect: noop }, { label: 'Delete', onSelect: noop, danger: true }]} /> },
  ] },
  { name: 'SettingsSection', use: 'A titled section with a description and actions on a Settings or Records screen.', kind: 'component', from: admin('SettingsSection.tsx'), owner: A, variants: [
    { label: 'default', render: () => <SettingsSection title="Currency" description="The family currency of every total."><p>Content.</p></SettingsSection> },
  ] },
  { name: 'FormDialog', use: 'Every form in a window: title, fields, Save and Cancel, the discard guard.', kind: 'component', from: admin('FormDialog.tsx'), owner: 'src/styles/ui-surfaces.css', variants: [
    { label: 'opens on demand', render: () => <FormDialogSample render={close => <FormDialog title="New account" submitLabel="Save" onSubmit={() => { close(); return true }} onCancel={close}><Field label="Name"><input className="admin-input" /></Field></FormDialog>} /> },
  ] },
  { name: 'AdminReadNotice', use: 'A failed read of a screen (Records, Settings, setup), with Retry; draws nothing while reads succeed.', kind: 'component', from: admin('AdminReadNotice.tsx'), owner: T, variants: [
    { label: 'failed read', render: () => <AdminReadNotice queries={[failed]} /> },
  ] },
  // charts
  { name: 'ThemedChart', use: 'The base of every ECharts chart (theme, size, motion); not for a simple bar (plain SVG).', kind: 'component', from: charts('ThemedChart.tsx'), owner: 'src/lib/chartColors.ts', variants: [
    { label: 'a bar series', render: () => <ThemedChart height={180} buildOption={() => ({ xAxis: { type: 'category', data: ['Jul', 'Aug', 'Sep'] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [3, 5, 4] }] })} /> },
  ] },
  { name: 'CapitalHistoryPanel', use: 'The net-worth history with its switches (Assets); the ECharts area chart inside.', kind: 'component', from: charts('CapitalHistoryPanel.tsx'), owner: 'src/styles/finance.css', variants: [
    { label: 'default', render: () => <CapitalHistoryPanel history={snapshot.history} state={initialCapitalHistoryState()} onChange={noop} /> },
  ] },
  { name: 'WaterfallSvg', use: 'A waterfall of changes from a start to an end total, in plain SVG.', kind: 'component', from: charts('WaterfallSvg.tsx'), owner: 'src/styles/assets.css', variants: [
    { label: 'default', render: () => <Amounts>{a => <WaterfallSvg label="Change of assets" start={{ name: 'Start', value: 100, label: a('$100') }} steps={[{ key: 'a', name: 'Savings', from: 100, to: 130, label: a('+$30') }, { key: 'b', name: 'Broker', from: 130, to: 120, label: a('−$10') }]} end={{ name: 'End', value: 120, label: a('$120') }} />}</Amounts> },
  ] },
  // finance
  { name: 'ClosedMonthResult', use: 'The summary of a month just closed (Overview with ?month=): what we did, milestones, the recap.', kind: 'component', from: finance('ClosedMonthResult.tsx'), owner: 'src/styles/finance.css', variants: [
    { label: 'the last month', render: () => <ClosedMonthResult month={lastMonth} snapshot={snapshot} /> },
  ] },
  { name: 'AvailabilityPanel', use: 'Available money: the family flow, the reserve, goals and each account (Assets → Available money).', kind: 'component', from: finance('AvailabilityPanel.tsx'), owner: 'src/styles/availability.css', variants: [
    { label: 'default', render: () => <AvailabilityPanel snapshot={snapshot} /> },
  ] },
  { name: 'FinancialAnswers', use: 'The questions-and-answers block of Overview and Health.', kind: 'component', from: finance('FinancialAnswers.tsx'), owner: 'src/styles/finance.css', variants: [
    { label: 'overview', render: () => <FinancialAnswers snapshot={snapshot} page="overview" /> },
  ] },
  { name: 'ForecastPanel', use: 'The cash forecast what-if on Income and expenses.', kind: 'component', from: finance('ForecastPanel.tsx'), owner: 'src/styles/finance.css', variants: [
    { label: 'default', render: () => <ForecastPanel snapshot={snapshot} /> },
  ] },
  { name: 'QuestionPanel', use: 'One question and its answer in a card; the frame of FinancialAnswers.', kind: 'component', from: finance('QuestionPanel.tsx'), owner: 'src/styles/finance.css', variants: [
    { label: 'default', render: () => <QuestionPanel question="Can we afford a car?" answer={<QuestionAnswer>Yes, in 14 months of saving.</QuestionAnswer>} /> },
  ] },
  { name: 'AllocationMeter', use: 'How much of a total is split into categories: a meter with the rest.', kind: 'component', from: finance('AllocationMeter.tsx'), owner: 'src/styles/allocation.css', variants: [
    { label: 'part allocated', render: () => <AllocationMeter label="Expenses" summary={{ total: 1000, allocated: 700, rest: 300, over: [] }} /> },
  ] },
]
