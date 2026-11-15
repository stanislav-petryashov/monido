import { useTranslation } from 'react-i18next'
import { monthEnd } from '../../domain/dates'
import type { capitalMovements, periodBridge } from '../../domain/financialAnalysis'
import { round2 } from '../../domain/fx'
import { WaterfallSvg } from '../../components/charts/WaterfallSvg'
import { Link } from '../../components/ui/Link'
import { fmtDayNumeric } from '../../lib/formatters'
import { PHONE, useMedia } from '../../lib/media'
import { signed } from '../../lib/pageHelpers'
import { holdingHref } from '../../lib/recordLink'
import '../../styles/assets.css'

/** The records shown by name; the rest are counted */
const SHOWN = 6

interface CapitalChangeProps {
  bridge: ReturnType<typeof periodBridge>
  /** The closed month's records that moved, largest first; null — the period is not the closed month alone */
  movements: ReturnType<typeof capitalMovements> | null
  /** The period's name for the meta line */
  periodName: string
  recordPaths: Partial<Record<'account' | 'realEstate' | 'loan', string>>
  fmt: (v: number) => string
}

/**
 * "What changed in net worth": the waterfall from net worth at the end of the month before the period, what the period
 * saved (ink), the rest (mid grey: rates, revaluation, repaid principal, corrections) to net worth at its end (the
 * primary tick), and its explanation; beside it the closed month's records that moved, each a link to its record.
 */
export function CapitalChange({ bridge, movements, periodName, recordPaths, fmt }: CapitalChangeProps) {
  const { t } = useTranslation()
  const compact = useMedia(PHONE)
  const recordOf = (row: { kind: 'account' | 'realEstate' | 'loan'; name: string; member: string }) => holdingHref(recordPaths, row)
  const shown = movements?.slice(0, SHOWN) ?? []
  const more = (movements?.length ?? 0) - shown.length
  const total = bridge ? signed(round2(bridge.end - bridge.start), fmt) : ''
  const previous = bridge ? t(`dates.monthOf.${Number(bridge.from.slice(5, 7))}`) : ''

  const startName = bridge ? t('cashflowPage.capital.start', { date: fmtDayNumeric(monthEnd(bridge.from)) }) : ''
  const endName = bridge ? t('cashflowPage.capital.end', { date: fmtDayNumeric(monthEnd(bridge.to)) }) : ''
  const contributions = bridge ? [{ key: 'saved', value: bridge.saving, tone: 'ink' }, { key: 'rest', value: bridge.other, tone: 'mid' }] : []
  const maxChange = bridge ? Math.max(1, Math.abs(bridge.saving), Math.abs(bridge.other)) : 1

  return (
    <section className="card card--p cf-card" aria-labelledby="cf-capital">
      <div className="card-hd--row cf-card__head">
        <h2 className="card-hd" id="cf-capital">{t('cashflowPage.capital.title')}</h2>
        {bridge && <span className="cf-meta">{`${periodName} · ${total}`}</span>}
      </div>
      {!bridge ? <p className="note">{t('cashflowPage.capital.empty')}</p> : (
        <div className="cf-capital">
          <div>
            {compact ? <div className="cf-bridge">
              <div className="cf-bridge__total"><span>{startName}</span><span className="num">{fmt(bridge.start)}</span></div>
              <ul className="cf-bridge__steps">
                {contributions.map(step => (
                  <li className="cf-bridge__step" key={step.key}>
                    <span className="cf-bridge__name">{t(`cashflowPage.capital.${step.key}`)}</span>
                    <span className="cf-bridge__track" aria-hidden="true"><i className={`asset-tone--${step.tone}`} style={{ width: `${Math.abs(step.value) / maxChange * 100}%` }} /></span>
                    <span className="num">{signed(step.value, fmt)}</span>
                  </li>
                ))}
              </ul>
              <div className="cf-bridge__total cf-bridge__total--end"><span>{endName}</span><span className="num">{fmt(bridge.end)}</span></div>
            </div> : <WaterfallSvg label={t('cashflowPage.capital.label')}
              start={{ name: startName, value: bridge.start, label: fmt(bridge.start) }}
              steps={[
                { key: 'saved', name: t('cashflowPage.capital.saved'), from: bridge.start, to: round2(bridge.start + bridge.saving), tone: 'ink', label: signed(bridge.saving, fmt) },
                { key: 'rest', name: t('cashflowPage.capital.rest'), from: round2(bridge.start + bridge.saving), to: bridge.end, tone: 'mid', label: signed(bridge.other, fmt) },
              ]}
              end={{ name: endName, value: bridge.end, label: fmt(bridge.end) }} />}
            <p className="note">{t('cashflowPage.capital.restNote')}</p>
          </div>
          <div className="cf-moves">
            {movements ? <>
              <h3 className="cf-detail__label">{t('cashflowPage.capital.records', { month: t(`dates.month.${Number(bridge.to.slice(5, 7))}`), previous })}</h3>
              <ul className="cf-moves__list">
                {shown.map(m => {
                  const href = recordOf(m)
                  return (
                    <li key={JSON.stringify([m.kind, m.name, m.member])}>
                      {href ? <Link to={href} className="link-accent">{m.name}</Link> : <span>{m.name}</span>}
                      {m.member && <span className="cf-meta">{m.member}</span>}
                      <b className="num">{signed(m.change, fmt)}</b>
                    </li>
                  )
                })}
              </ul>
              <p className="note">{more > 0 ? t('cashflowPage.capital.more', { count: more, total }) : t('cashflowPage.capital.total', { total })}</p>
            </> : <p className="note">{t('cashflowPage.capital.closedOnly')}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
