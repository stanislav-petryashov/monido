import { SegmentedPills } from '../../components/ui/SegmentedPills'
import { Suspense, useMemo, useState } from 'react'
import { lazyWithChunks } from '../../i18n/lazyWithChunks'
import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { OwnerAvatar } from '../../components/ui/OwnerAvatar'
import { monthOf } from '../../domain/dates'
import { selectedDeltas } from '../../domain/overviewBlocks'
import type { FinanceSnapshot } from '../../domain/types'
import { buildCapitalHistory, capitalPresetRange, type CapitalHistoryPreset } from '../../lib/capitalHistory'
import { useDashboard } from '../../lib/dashboardState'
import { fmtDayYear, fmtInMonth } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'
import { overviewComposition, overviewHistory } from './capitalBalances'
import '../../styles/accounts.css'
import '../../styles/finance.css'
import '../../styles/overview-capital.css'

const AreaChart = lazyWithChunks(() => import('../../components/charts/AreaChart').then(m => ({ default: m.AreaChart })), 'planning')

interface Props {
  snapshot: FinanceSnapshot
  owner: string | null
  setOwner: (owner: string | null) => void
  preset: CapitalHistoryPreset
  setPreset: (preset: CapitalHistoryPreset) => void
}

const key = (name: string) => 'pages.overview.balances.' + name
const presets = ['3m', '6m', '12m', 'all'] as const

const colors: Record<string, string> = { cash: 'var(--chart-2)', investments: 'var(--chart-3)', property: 'var(--chart-1)', other: 'var(--chart-5)' }
const labels: Record<string, string> = { cash: key('cash'), investments: key('investments'), property: 'accounts.class.real_estate', other: 'accounts.class.other' }

export function CapitalSummary({ snapshot, owner, setOwner, preset, setPreset }: Props) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const [selected, setSelected] = useState<string | null>(null)
  const { history, partial } = useMemo(() => overviewHistory(snapshot, owner), [snapshot, owner])
  const model = useMemo(() => buildCapitalHistory(history, capitalPresetRange(history, preset), 'amount', [...partial]), [history, partial, preset])
  const c = snapshot.capital
  const composition = overviewComposition(snapshot, owner)
  if (!c || !composition) return <Card><p className="note">{t('pages.netWorth.empty')}</p></Card>
  const month = monthOf(c.date)
  const latest = history.at(-1)
  const net = latest && monthOf(latest.date) === month && !partial.has(month) ? latest.netWorth : null
  const change = selectedDeltas(history, month, partial).month
  const money = (amount: number | null) => amount === null ? '—' : fmt(amount)
  const parts = Object.entries(composition.parts).filter(([type, amount]) => type !== 'other' || amount !== 0)
  const { assets, debts } = composition
  const activeMonth = model.selected.find(m => m.month === selected)?.month ?? model.selected.at(-1)?.month ?? null
  const owners = new Set(snapshot.members)
  for (const item of [...c.accounts, ...c.realEstate, ...c.loans]) owners.add(item.member)
  return <div className="overview-capital">
    <p className="note overview-capital__date">{t(key('asOf'), { date: fmtDayYear(c.date) })}</p>
    <div className="overview-capital__filters">
      <SegmentedPills appearance="owners" ariaLabel={t('data.accounts.ownerFilter')}
        items={[null, ...owners]} active={owner} onSelect={m => { setOwner(m); setSelected(null) }}
        label={m => m === null ? t(key('family')) : <>
          {m && <OwnerAvatar member={m} members={snapshot.members} />}{m || t('pages.netWorth.noMember')}
        </>} />
      <SegmentedPills appearance="history" ariaLabel={t('pages.netWorth.historyPanel.period')}
        items={presets} active={preset} onSelect={p => { setPreset(p); setSelected(null) }} label={p => t(key(p))} />
    </div>
    <div className="overview-capital__columns">
      <Card className="overview-capital__balance">
        <h2 className="overview__title">{t(key(owner === null ? 'familyCapital' : 'personalCapital'))}</h2>
        <strong className="overview-capital__total">{money(net)}</strong>
        {change !== null && <p className="note">{signed(change, fmt)} {fmtInMonth(month)}</p>}
        {partial.has(month) && <p className="note">{t('pages.overview.netWorthIncomplete')}</p>}
        <dl className="overview-capital__composition">
          <div className="overview-capital__subtotal overview-capital__assets">
            <dt>{t('pages.netWorth.historyPanel.assets')}</dt>
            <dd>{money(assets)}</dd>
            {assets !== null && assets > 0 && parts.every(([, v]) => v !== null && v >= 0) && <dd aria-hidden="true" className="overview-capital__bar">
              {parts.filter(([, v]) => v).map(([type, value]) => <i key={type} style={{ flex: value ?? 0, backgroundColor: colors[type] }} />)}
            </dd>}
          </div>
          {parts.map(([type, value]) => <div key={type}><dt><i className="overview-capital__swatch" style={{ backgroundColor: colors[type] }} />{t(labels[type])}</dt><dd>{money(value)}</dd></div>)}
          <div className="overview-capital__subtotal"><dt>{t(key('debts'))}</dt><dd>{money(debts)}</dd></div>
        </dl>
      </Card>
      <Card className="overview-capital__chart">
        <h2 className="overview__title">{t(key('trend'))}</h2>
        <p className="note">{t('pages.netWorth.historyPanel.capital')}, {snapshot.baseCurrency}</p>
        {model.selected.some(m => m.point)
          ? <Suspense fallback={<div style={{ height: 240 }} aria-busy="true" />}><AreaChart overview model={model} visibleSeries={['capital']} selectedMonth={activeMonth} onSelectMonth={setSelected} height={240} /></Suspense>
          : <p className="note">{t('pages.netWorth.historyPanel.missingMonth')}</p>}
      </Card>
    </div>
  </div>
}
