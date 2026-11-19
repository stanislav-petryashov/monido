import { Fragment, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { mainRate, type PeriodChange, type Story } from '../../domain/capitalStory'
import { monthEnd, shiftMonth } from '../../domain/dates'
import { round2 } from '../../domain/fx'
import type { ChangeRowKey, MonthChangeGap } from '../../domain/types'
import { monthTitle } from '../../i18n/dates'
import { DisclosureChevron } from '../../components/ui/DisclosureChevron'
import { Link } from '../../components/ui/Link'
import { fmtDayNumeric, fmtNum } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'
import { useMoney } from '../../lib/privacy'
import { holdingHref } from '../../lib/recordLink'
import '../../styles/cashflow.css'

interface CapitalBridgeProps {
  change: PeriodChange | MonthChangeGap
  /** The sentence of `change` (changeStory); null for a gap */
  story: Story | null
  /** «Markets and rates went negative in N of M months»; null — too short a window */
  yard: { negative: number; total: number; largest: boolean } | null
  periodName: string
  recordPaths: Partial<Record<'account' | 'realEstate' | 'loan', string>>
  fmt: (v: number) => string
  /** The display currency, for a rate phrased per its unit */
  base?: string
  /** Drawn at the end of the card: the history */
  children?: ReactNode
}

type Tone = 'you' | 'markets' | 'rest'
const GROUPS: Record<PeriodChange['form'], { key: 'added' | 'accounts' | 'markets'; rows: ChangeRowKey[]; tone: Tone }[]> = {
  tracked: [{ key: 'added', rows: ['saved', 'debtPaid', 'earlyInterest'], tone: 'you' }, { key: 'markets', rows: ['investments', 'fx', 'property'], tone: 'markets' }],
  balances: [{ key: 'accounts', rows: ['accounts', 'debtPaid', 'earlyInterest'], tone: 'you' }, { key: 'markets', rows: ['fx', 'property'], tone: 'markets' }],
}
/** Rows always shown, even at 0; the others only when the period has them */
const ALWAYS = new Set<ChangeRowKey>(['saved', 'accounts', 'debtPaid', 'investments', 'fx', 'property'])

/**
 * "What changed our net worth": the sentence that names the main cause and what the family added, the yardstick, then the
 * bridge in rows from net worth at the start to the end: the family's group, markets and rates, the neutral moves and the
 * unexplained rest, each bar placed on the running level. Rows with accounts behind them open; the largest opens first.
 */
export function CapitalBridge({ change, story, yard, periodName, recordPaths, fmt, base, children }: CapitalBridgeProps) {
  const { t } = useTranslation()
  // an own-currency amount, masked in privacy mode like every other amount
  const own = useMoney()
  const p = 'rows' in change ? change : null
  const [open, setOpen] = useState<Set<ChangeRowKey>>(() => new Set(p ? [largestOpenable(p)].filter(k => k !== null) : []))
  const toggle = (k: ChangeRowKey) => setOpen(was => { const next = new Set(was); if (next.has(k)) next.delete(k); else next.add(k); return next })

  const head = (
    <div className="card-hd--row cf-card__head">
      <h2 className="card-hd" id="cc-title">{t('capitalChange.title')}</h2>
      {p && <span className="cf-meta">{t('capitalChange.meta', { period: periodName, change: signed(round2(p.end - p.start), fmt) })}</span>}
    </div>
  )
  if (!p) return (
    <section className="card card--p cf-card" aria-labelledby="cc-title">
      {head}
      <p className="note">{t(`capitalChange.gap.${(change as MonthChangeGap).reason}`, { month: monthTitle(t, (change as MonthChangeGap).at ?? (change as MonthChangeGap).month) })}</p>
      {children}
    </section>
  )

  // the sentence's cause amount is signed; the tail's is not: its words already say added or took out
  const text = (story: Omit<Story, 'tail'>, signedAmount: boolean) => t(story.key, {
    ...Object.fromEntries(Object.entries(story.params).map(([k, v]) => [k, typeof v !== 'number' ? v
      : k === 'from' || k === 'to' ? fmtNum(v, 2)
        : story.signed?.includes(k) || (k === 'amount' && signedAmount) ? signed(v, fmt) : fmt(Math.abs(v))])),
    period: periodName, base,
  })
  const value = (k: ChangeRowKey) => p.rows[k] ?? 0

  // the running level of each step, and the scale of the bars: from the lowest level to the highest
  const steps: { key: ChangeRowKey; from: number; to: number }[] = []
  let level = p.start
  const order = [...GROUPS[p.form].flatMap(g => g.rows), 'unexplained' as const]
  for (const k of order) {
    if (!(k in p.rows)) continue
    steps.push({ key: k, from: level, to: round2(level + value(k)) })
    level = round2(level + value(k))
  }
  const levels = [p.start, p.end, ...steps.flatMap(x => [x.from, x.to])]
  const lo = Math.min(...levels), span = Math.max(...levels) - lo || 1
  const at = (v: number) => `${((v - lo) / span) * 100}%`
  const bar = (k: ChangeRowKey, tone: Tone) => {
    const step = steps.find(x => x.key === k)!
    const from = Math.min(step.from, step.to)
    return <span className="cc-row__bar" aria-hidden="true">{step.from === step.to
      ? <i className="cc-tick" style={{ left: at(step.from) }} />
      : <i className={`cc-bar cc-tone--${tone}`} style={{ left: at(from), width: `${(Math.abs(step.to - step.from) / span) * 100}%` }} />}</span>
  }

  const earlyTotal = round2(p.pairs.filter(x => x.kind === 'early').reduce((a, x) => a + x.amount, 0))
  // the main rate always names the exchange-rates row: for a family in several currencies it is the row's fact
  const rate = mainRate(p)
  const fxSub = rate ? t(rate.inverse ? 'capitalChange.rows.fxSubPer' : 'capitalChange.rows.fxSub', { currency: rate.currency, from: fmtNum(rate.from, 2), to: fmtNum(rate.to, 2), base }) : ''
  const sub = (k: ChangeRowKey): string => ({
    saved: value('saved') < 0 ? '' : t('capitalChange.rows.savedSub'), debtPaid: t('capitalChange.rows.debtPaidSub'),
    investments: t('capitalChange.rows.investmentsSub'), fx: fxSub,
    property: value('property') === 0 ? t('capitalChange.rows.propertySub') : '', moves: t('capitalChange.rows.movesSub'),
    unexplained: p.candidates.length ? t('capitalChange.unexplained.count', { count: p.candidates.length }) : '',
  } as Partial<Record<ChangeRowKey, string>>)[k] ?? ''
  const name = (k: ChangeRowKey) => t(`capitalChange.rows.${k === 'saved' && value('saved') < 0 ? 'overspent' : k}`)

  const details = (k: ChangeRowKey): ReactNode => {
    if (k === 'unexplained') return p.candidates.length ? <>
      <p className="note">{t('capitalChange.unexplained.candidates')}</p>
      <ul className="cc-items">{p.candidates.map(c => (
        <li key={JSON.stringify([c.name, c.member, c.reason])}>
          <span>{record({ kind: 'account', name: c.name, member: c.member })}<span className="cf-meta">{t(`capitalChange.unexplained.${c.reason}`)}</span></span>
          <b className="num">{signed(c.change, fmt)}</b>
        </li>))}</ul>
    </> : <p className="note">{t('capitalChange.unexplained.rounding')}</p>
    if (k === 'moves') return <ul className="cc-items">{p.pairs.map((x, i) => (
      <li key={i}><span>{t(`capitalChange.moves.${x.kind}`, { name: x.name })}</span><b className="num">{signed(x.amount, fmt)}</b></li>))}</ul>
    const list = p.items[k as 'fx' | 'debtPaid' | 'property' | 'investments'] ?? []
    return <>
      <ul className="cc-items">{list.map(i => (
        <li key={JSON.stringify([i.kind, i.name, i.member, i.currency])}>
          <span>{record(i)}{i.member && <span className="cf-meta">{i.member}</span>}{k === 'fx' && i.native !== undefined && <span className="cf-meta">{own(i.native, i.currency)}</span>}</span>
          <b className="num">{signed(i.amount, fmt)}</b>
        </li>))}</ul>
      {k === 'investments' && p.candidates.some(c => c.reason === 'no_transfer') && <p className="note">{t('capitalChange.investmentsNote')}</p>}
    </>
  }
  const record = (r: { kind: 'account' | 'realEstate' | 'loan'; name: string; member: string }) => {
    const href = holdingHref(recordPaths, r)
    return href ? <Link to={href} className="link-accent">{r.name}</Link> : <span>{r.name}</span>
  }
  const openable = (k: ChangeRowKey) => openableRow(p, k)

  const line = (k: ChangeRowKey, tone: Tone) => {
    const inner = <>
      <span className="cc-row__name">{openable(k) && <DisclosureChevron size={16} />}{name(k)}{sub(k) && <span className="cf-meta">{sub(k)}</span>}</span>
      {k === 'moves' ? <span className="cc-row__bar" aria-hidden="true" /> : bar(k, tone)}
      <span className="cc-row__value num">{signed(value(k), fmt)}</span>
    </>
    return <Fragment key={k}>
      {openable(k)
        ? <button type="button" className={`cc-row${k === 'unexplained' ? ' cc-row--rest' : ''}`} aria-expanded={open.has(k)} onClick={() => toggle(k)}>{inner}</button>
        : <div className="cc-row">{inner}</div>}
      {k === 'debtPaid' && earlyTotal > 0 && <p className="cc-hint">{t('capitalChange.rows.earlyHint', { amount: fmt(earlyTotal) })}</p>}
      {openable(k) && open.has(k) && <div className="cc-detail">{details(k)}</div>}
    </Fragment>
  }

  const total = (label: string, v: number, end = false) => (
    <div className={`cc-row cc-row--total${end ? ' cc-row--end' : ''}`}>
      <span className="cc-row__name">{label}</span>
      <span className="cc-row__bar" aria-hidden="true"><i className="cc-tick" style={{ left: at(v) }} /></span>
      <span className="cc-row__value num">{fmt(v)}</span>
    </div>
  )
  const added = round2(GROUPS[p.form][0].rows.reduce((a, k) => a + value(k), 0))

  return (
    <section className="card card--p cf-card" aria-labelledby="cc-title">
      {head}
      {story && <p className="cc-lead"><span>{text(story, true)}</span>{story.tail && <>{' '}<span>{text(story.tail, false)}</span></>}</p>}
      {yard && <p className="cf-meta cc-yard">{t(yard.largest ? 'capitalChange.yardstickLargest' : 'capitalChange.yardstick', { count: yard.negative, total: yard.total })}</p>}
      <div className="cc-list" role="group" aria-label={t('capitalChange.label')}>
        {total(t('capitalChange.start', { date: fmtDayNumeric(monthEnd(shiftMonth(p.months[0], -1))) }), p.start)}
        {GROUPS[p.form].map(g => {
          const sum = round2(g.rows.reduce((a, k) => a + value(k), 0))
          return <Fragment key={g.key}>
            <div className="cc-row cc-row--group"><span className="cc-row__name"><i className={`cf-swatch cc-tone--${g.tone}`} />{g.key === 'added' && added < 0 ? t('capitalChange.groups.tookOut') : t(`capitalChange.groups.${g.key}`)}</span><span className="cc-row__bar" aria-hidden="true" /><span className="cc-row__value num">{signed(sum, fmt)}</span></div>
            {g.rows.filter(k => ALWAYS.has(k) ? k in p.rows : value(k) !== 0).map(k => line(k, g.tone))}
          </Fragment>
        })}
        {'moves' in p.rows && line('moves', 'rest')}
        {'unexplained' in p.rows && line('unexplained', 'rest')}
        {total(t('capitalChange.end', { date: fmtDayNumeric(monthEnd(p.months[p.months.length - 1])) }), p.end, true)}
      </div>
      {p.form === 'balances' && <p className="note">{t('capitalChange.balancesHint')}</p>}
      {children}
    </section>
  )
}

function openableRow(p: PeriodChange, k: ChangeRowKey): boolean {
  if (k === 'unexplained') return true
  if (k === 'moves') return p.pairs.length > 0
  return (p.items[k as 'fx' | 'debtPaid' | 'property' | 'investments'] ?? []).length > 0
}

function largestOpenable(p: PeriodChange): ChangeRowKey | null {
  const keys = (Object.keys(p.rows) as ChangeRowKey[]).filter(k => k !== 'moves' && openableRow(p, k))
  return keys.length ? keys.reduce((a, b) => (Math.abs(p.rows[b] ?? 0) > Math.abs(p.rows[a] ?? 0) ? b : a)) : null
}
