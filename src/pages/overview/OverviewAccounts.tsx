import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { accountKey } from '../../domain/accounts'
import { assetChanges, currentHoldings } from '../../domain/assetChanges'
import { monthOf, shiftMonth } from '../../domain/dates'
import type { FinanceSnapshot } from '../../domain/types'
import { capitalPresetRange, type CapitalHistoryPreset } from '../../lib/capitalHistory'
import { useDashboard } from '../../lib/dashboardState'
import { EntryTable } from '../admin/ui/EntryTable'
import { fmtInMonth, fmtMonth } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import '../../styles/overview-ledger.css'

const GROUPS = ['accounts', 'loans'] as const

interface LedgerRow {
  name: string
  member: string
  balance: number | null
  delta: number | null
}

function ledgerRows(snapshot: FinanceSnapshot): { accounts: LedgerRow[]; loans: LedgerRow[] } {
  const capital = snapshot.capital
  if (!capital) return { accounts: [], loans: [] }
  const previous = snapshot.previousCapital
  const holdings = assetChanges(snapshot, 'month')?.holdings ?? currentHoldings(capital, snapshot)
  const accounts = holdings.filter(h => h.kind === 'account').map(h => ({
    name: h.name, member: h.member, balance: h.valueKnown ? h.valueBase : null, delta: h.changeKnown ? h.change : null,
  }))
  const now = new Map(capital.loans.map(l => [accountKey(l.name, l.member), l]))
  const before = new Map(previous?.loans.map(l => [accountKey(l.name, l.member), l]))
  const loans: LedgerRow[] = []
  for (const [key, loan] of new Map([...before, ...now])) {
    // A loan absent from a month's schedule wasn't owed then. An absent month or exchange rate is unknown.
    const currentLoan = now.get(key), previousLoan = before.get(key)
    const balance = currentLoan ? currentLoan.balanceBase : 0
    const start = previousLoan ? previousLoan.balanceBase : previous ? 0 : null
    if (balance === 0 && (!previousLoan || start === 0)) continue
    loans.push({ name: loan.name, member: loan.member, balance, delta: balance === null || start === null ? null : balance - start })
  }
  return { accounts, loans }
}

function BalanceTrend({ months, values }: { months: string[]; values: (number | null)[] }) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const { hidden } = usePrivacy()
  if (hidden) return <span>{PRIVACY_MASK}</span>
  const known = values.flatMap((value, index) => value === null ? [] : [{ value, index }])
  const first = known.at(0), last = known.at(-1)
  if (known.length < 2 || !first || !last) return <span className="ledger-muted">{t('pages.overview.ledger.shortHistory')}</span>
  const low = Math.min(...known.map(p => p.value)), high = Math.max(...known.map(p => p.value))
  const coords = known.map(({ index, value }) => ({
    index, x: 2 + 92 * index / (months.length - 1), y: high === low ? 14 : 26 - (value - low) / (high - low) * 24,
  }))
  const path = coords.map(({ x, y, index }, i) => (coords[i - 1]?.index === index - 1 ? 'L' : 'M') + x + ',' + y).join(' ')
  const label = t('pages.overview.ledger.trendRange', {
    from: fmtMonth(months[first.index]), start: fmt(first.value), to: fmtMonth(months[last.index]), end: fmt(last.value),
  })
  return <svg viewBox="0 0 96 28" role="img" aria-label={label}>
    <title>{label}</title>
    <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    {coords.filter(({ index }) => values[index - 1] == null && values[index + 1] == null)
      .map(p => <circle key={p.index} cx={p.x} cy={p.y} r="2" fill="currentColor" />)}
  </svg>
}

export function OverviewAccounts({ snapshot, owner, preset }: { snapshot: FinanceSnapshot; owner: string | null; preset: CapitalHistoryPreset }) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const { hidden } = usePrivacy()
  const rows = useMemo(() => ledgerRows(snapshot), [snapshot])
  const range = capitalPresetRange(snapshot.history, preset)
  const months: string[] = []
  if (range) for (let m = range.from; m <= range.to; m = shiftMonth(m, 1)) months.push(m)
  const history = useMemo(() => new Map(snapshot.balanceHistory?.map(point => [point.month, {
    accounts: new Map(point.accounts.map(r => [accountKey(r.name, r.member), r.valueBase])),
    loans: new Map(point.loans.map(r => [accountKey(r.name, r.member), r.balanceBase])),
  }])), [snapshot.balanceHistory])
  if (!snapshot.capital) return null
  const end = monthOf(snapshot.capital.date)
  return <section className="card card--p overview-ledger" aria-labelledby="overview-ledger-title">
    <header>
      <h2 className="overview__title" id="overview-ledger-title">{t('pages.overview.ledger.title')}</h2>
      <span className="overview-ledger__scope"><span>{owner === null ? t('pages.overview.balances.family') : owner || t('pages.netWorth.noMember')}</span><span>{t(`pages.overview.balances.${preset}`)}</span></span>
    </header>
    <div className="overview-ledger__books">{GROUPS.map(group => {
      const list = rows[group].filter(r => owner === null || r.member === owner)
      const groupName = t(group === 'accounts' ? 'routes.accounts' : 'modules.loans.title')
      return <div key={group}><h3>{groupName}</h3>
        {!list.length ? <p className="ledger-muted">{t(group === 'accounts' ? 'pages.overview.ledger.noAccounts' : 'pages.overview.ledger.noLoans')}</p> :
          <EntryTable label={groupName} reading><thead><tr>
            <th scope="col">{t('pages.overview.ledger.name')}</th><th scope="col">{t('pages.overview.ledger.trend')}</th><th scope="col">{t('pages.overview.ledger.balance')}</th>
          </tr></thead><tbody>{list.map(r => {
            const key = accountKey(r.name, r.member)
            const values = months.map(m => m === end ? r.balance : history.get(m)?.[group].get(key) ?? null)
            return <tr key={key}>
              <th scope="row">{r.name}{owner === null && <small>{r.member || t('pages.netWorth.noMember')}</small>}</th>
              <td className={group === 'loans' ? 'ledger-loan' : 'ledger-account'}><BalanceTrend months={months} values={values} /></td>
              <td className="ledger-amount"><strong>{r.balance === null ? t('common.noData') : fmt(r.balance)}</strong>
                {r.delta !== null && <small>{hidden ? PRIVACY_MASK : r.delta === 0 ? t('pages.overview.ledger.unchanged') : <>{signed(r.delta, fmt)} {fmtInMonth(end)}</>}</small>}
              </td></tr>
          })}</tbody></EntryTable>}
      </div>
    })}</div>
  </section>
}
