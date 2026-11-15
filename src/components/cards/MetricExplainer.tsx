import { IconInfoCircle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { Fact, MetricKey } from '../../domain/metricCatalog'
import { useDashboard } from '../../lib/dashboardState'
import { factLabel, factText, metricCaveat, metricFormula, metricMeaning, metricTitle } from '../../lib/metricText'
import { useDisclosure } from '../ui/usePopover'

interface Props {
  metric: MetricKey
  /** What the number was made of, value first (`explanationFacts`): amounts go through the privacy-aware `fmt` */
  facts: Fact[]
  /** Lines the metric adds from its own numbers (the months used and left out) */
  notes?: string[]
}

/**
 * «How it is calculated» behind an info button in a card title: the meaning, the formula, the family's own inputs and the
 * caveat, all from the catalog and the snapshot — nothing is recomputed here. Open/close mechanics are useDisclosure's.
 */
export function MetricExplainer({ metric, facts, notes = [] }: Props) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const { open, rootRef, triggerRef, panelId, triggerProps } = useDisclosure()
  const title = metricTitle(metric)
  const caveat = metricCaveat(metric)
  return (
    <div className="explain" ref={rootRef}>
      <button ref={triggerRef} type="button" className="explain__btn" aria-label={t('metrics.explain.open', { title })} {...triggerProps}>
        <IconInfoCircle size={18} stroke={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} className="explain__panel">
          <div className="explain__hd">{t('metrics.explain.heading')}</div>
          <p>{metricMeaning(metric)}</p>
          <p>{metricFormula(metric)}</p>
          <dl className="explain__inputs">
            {facts.map(f => (
              <div key={`${f.label}${JSON.stringify(f.labelParams ?? {})}`}>
                <dt>{factLabel(f)}</dt>
                <dd className="num">{factText(f, fmt)}</dd>
              </div>
            ))}
          </dl>
          {notes.map(n => <p key={n} className="note">{n}</p>)}
          {caveat && <p className="explain__caveat">{caveat}</p>}
        </div>
      )}
    </div>
  )
}
