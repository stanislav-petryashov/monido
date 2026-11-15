import { useTranslation } from 'react-i18next'
import type { AssetChanges } from '../../domain/assetChanges'
import { PHONE, useMedia } from '../../lib/media'
import { round2 } from '../../domain/fx'
import { fmtMonth } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'
import { WaterfallSvg } from '../../components/charts/WaterfallSvg'
import { holdingKey, holdingTones } from './tones'

interface ChangeWaterfallProps {
  changes: AssetChanges
  /** The period's last month, 'YYYY-MM' */
  endMonth: string
  fmt: (v: number) => string
}

/**
 * What made up the period's change: the start total as a tick with its value, one row per holding (largest gain
 * first) — a bar from the running total in the holding's map tone, its signed change, "rate" when the move is the
 * rate alone — and the end total as a primary tick (WaterfallSvg). On phones, signed groups share an absolute scale.
 */
export function ChangeWaterfall({ changes, endMonth, fmt }: ChangeWaterfallProps) {
  const { t } = useTranslation()
  const phone = useMedia(PHONE)
  // a holding without a rate at one end has no change to show
  const rows = changes.holdings.filter(h => !h.noRate)
  const toneOf = holdingTones(changes.holdings)
  const path = rows.reduce((run, h) => [...run, round2(run[run.length - 1] + h.change)], [changes.startTotal])
  const end = path[path.length - 1]
  const maxChange = Math.max(1, ...rows.map(h => Math.abs(h.change)))
  const valueLabel = (h: (typeof rows)[number]) => (h.change === 0 ? fmt(0) : h.startNoRate ? `${signed(h.change, fmt)} · ${t('pages.assets.startNoRate')}`
    : h.currencyOnly ? `${signed(h.change, fmt)} · ${t('pages.assets.fxShort')}` : signed(h.change, fmt))

  return (
    <section className="card card--p" aria-labelledby="assets-waterfall">
      <div className="card-hd--row">
        <h2 className="card-hd" id="assets-waterfall">{t('pages.assets.waterfallTitle')}</h2>
        {changes.complete && <span className="assets-meta">{`${fmtMonth(changes.startMonth)} → ${fmtMonth(endMonth)} · ${signed(changes.change, fmt)}`}</span>}
      </div>
      {!changes.complete ? <p className="note">{t('pages.assets.incomplete')}</p> : phone ? <div className="contributions">
        {[
          { title: t('pages.assets.decreasedValue'), items: rows.filter(h => h.change < 0) },
          { title: t('pages.assets.increasedValue'), items: rows.filter(h => h.change > 0) },
          { title: t('pages.assets.unchangedValue'), items: rows.filter(h => h.change === 0) },
        ].filter(group => group.items.length).map(group => <section className="contributions__group" key={group.title} aria-label={group.title}>
          <h3 className="contributions__heading">{group.title}</h3>
          <ul>{group.items.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).map(h => <li className="contributions__row" key={holdingKey(h)}>
            <span className="contributions__name">{h.name}{(h.startNoRate || h.currencyOnly) && <span className="contributions__note"> · {t(h.startNoRate ? 'pages.assets.startNoRate' : 'pages.assets.fxShort')}</span>}</span>
            <div className="contributions__track" aria-hidden="true"><i className={`asset-tone--${toneOf(h)}`} style={{ width: `${Math.abs(h.change) / maxChange * 100}%` }} /></div>
            <span className="contributions__amount num">{h.change === 0 ? fmt(0) : signed(h.change, fmt)}</span>
          </li>)}</ul>
        </section>)}
        <div className="contributions__totals">
          <div className="contributions__total"><span>{fmtMonth(changes.startMonth)}</span><span className="num">{fmt(changes.startTotal)}</span></div>
          <div className="contributions__total contributions__total--current"><span>{fmtMonth(endMonth)}</span><span className="num">{fmt(end)}</span></div>
        </div>
      </div> : <WaterfallSvg
        label={t('pages.assets.waterfallLabel', { start: fmt(changes.startTotal), end: fmt(end) })}
        start={{ name: fmtMonth(changes.startMonth), value: changes.startTotal, label: fmt(changes.startTotal) }}
        steps={rows.map((h, k) => ({ key: holdingKey(h), name: h.name, from: path[k], to: path[k + 1], tone: toneOf(h), label: valueLabel(h) }))}
        end={{ name: fmtMonth(endMonth), value: end, label: fmt(end) }} />}
    </section>
  )
}
