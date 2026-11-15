import { ProgressTrack } from '../../components/ui/ProgressTrack'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ANNUAL_RETURN } from '../../domain/goals'
import type { FireSummary } from '../../domain/types'
import { Link } from '../../components/ui/Link'
import { fmtMonthNumeric, fmtNum, fmtPct, fmtSpan } from '../../lib/formatters'
import { deadlineOf, lateBy, type Tone } from './text'
import type { GoalLine } from './view'

interface GoalHeadProps {
  line: GoalLine
  fire: FireSummary | null
  /** The monthly saving; null — income and expenses are not tracked */
  saving: number | null
  /** The smallest saving that makes the deadline (savingToMeet); null — none to name */
  meet: number | null
  /** The closed months the saving is the average of, with their nets, as words */
  months: string
  fmt: (v: number) => string
  /** «Update saved» and the «···» menu (GoalActions); null — a viewer */
  actions: ReactNode
  /** Opens the editor with this deadline month; null — a viewer (the words stay plain text) */
  onMoveDeadline: ((month: string) => void) | null
}

interface Kpi { key: string; label: string; value: string; meta?: string; tone?: Tone }

/**
 * The chosen goal's head: the name and tags (deadline, how far, currency, its place in the plan), «Update saved» and the
 * «···» menu, the KPI strip, the progress, one verdict with the way out, the notice while the saving is unknown and the
 * source line. Independence reads its forecast with the return and the growth it needs instead of the need a month.
 */
export function GoalHead({ line, fire, saving, meet, months, fmt, actions, onMoveDeadline }: GoalHeadProps) {
  const { t } = useTranslation()
  const a = line.alloc
  const known = saving !== null && a !== null
  const deadline = deadlineOf(line)
  const target = line.item.targetBase
  const current = line.item.currentBase
  const money = (v: number | null) => (v === null ? '—' : fmt(v))
  const rate = fmtNum(ANNUAL_RETURN * 100, 0)
  const pct = a?.progressPct ?? 0
  const steps = line.steps
  const reached = a?.projectedDate ?? null

  const gets = (): Kpi => {
    if (!known || !steps) return { key: 'gets', label: t('goalsPage.kpi.gets'), value: '—', meta: t('goalsPage.kpi.unknown'), tone: 'gl-mut' }
    const later = steps.later
    const meta = later
      ? (later.next !== null && Math.abs(later.next - later.perMonthBase) > 0.005
        ? t('goalsPage.kpi.getsLaterNext', { month: fmtMonthNumeric(later.month), amount: fmt(later.perMonthBase), next: fmt(later.next) })
        : t('goalsPage.kpi.getsLater', { month: fmtMonthNumeric(later.month), amount: fmt(later.perMonthBase) }))
      : steps.now > 0 && reached ? t('goalsPage.kpi.getsUntil', { month: fmtMonthNumeric(reached) }) : a.status === 'done' ? undefined : t('goalsPage.kpi.getsNone')
    return { key: 'gets', label: t('goalsPage.kpi.gets'), value: fmt(steps.now), meta }
  }
  const when = (label: string): Kpi => {
    if (!known) return { key: 'when', label, value: '—', meta: t('goalsPage.kpi.needFlows'), tone: 'gl-mut' }
    if (a.status === 'done') return { key: 'when', label, value: '—', meta: t('goalsPage.status.done') }
    if (!reached) return { key: 'when', label, value: '—', meta: t('goalsPage.kpi.never'), tone: 'gl-late' }
    return a.status === 'on_track'
      ? { key: 'when', label, value: fmtMonthNumeric(reached), meta: t('goalsPage.kpi.onTime'), tone: 'gl-ok' }
      : { key: 'when', label, value: fmtMonthNumeric(reached), meta: t('goalsPage.kpi.lateBy', { span: lateBy(line, reached) }), tone: 'gl-late' }
  }
  const kpis: Kpi[] = line.isFire ? [
    { key: 'saved', label: t('goalsPage.kpi.saved'), value: money(current), meta: t('goalsPage.kpi.savedFireMeta', { target: money(target), pct: fmtPct(pct) }) },
    gets(),
    when(t('goalsPage.kpi.forecast', { rate })),
    {
      key: 'growth', label: t('goalsPage.kpi.growth'),
      value: fire?.requiredCagr == null ? '—' : fmtPct(fire.requiredCagr * 100, { sign: true }),
      meta: fire?.actualCagr == null
        ? t('goalsPage.kpi.growthNoHistory', { month: fmtMonthNumeric(deadline) })
        : t('goalsPage.kpi.growthMeta', { month: fmtMonthNumeric(deadline), actual: fmtPct(fire.actualCagr * 100, { sign: true }) }),
    },
  ] : [
    { key: 'saved', label: t('goalsPage.kpi.saved'), value: money(current), meta: t('goalsPage.kpi.savedMeta', { target: money(target) }) },
    !a || a.status === 'done'
      ? { key: 'need', label: t('goalsPage.kpi.need'), value: '—' }
      : a.monthsToDeadline > 0
        ? { key: 'need', label: t('goalsPage.kpi.need'), value: fmt(a.requiredMonthlyBase), meta: t('goalsPage.kpi.needMeta', { left: money(target === null || current === null ? null : target - current), span: fmtSpan(a.monthsToDeadline) }) }
        : { key: 'need', label: t('goalsPage.kpi.need'), value: money(target === null || current === null ? null : target - current), meta: t('goalsPage.kpi.needOverdue') },
    gets(),
    when(t('goalsPage.kpi.reached')),
  ]

  const verdict = known ? verdictOf() : null
  function verdictOf() {
    if (!a || a.status === null) return null
    if (a.status === 'done') return t('goalsPage.verdict.done')
    if (line.isFire) {
      const held = fire?.atDeadlineBase ?? null
      if (held === null || !target) return null
      const params = { rate, atDeadline: fmt(held), pct: fmtPct((held / target) * 100) }
      return steps && steps.now <= 0 && steps.later
        ? t('goalsPage.verdict.fireWaits', { ...params, month: fmtMonthNumeric(steps.later.month) })
        : t('goalsPage.verdict.fireNow', params)
    }
    if (a.status === 'on_track') return line.order === 1 && steps
      ? t('goalsPage.verdict.onTrackFirst', { amount: fmt(steps.now), month: fmtMonthNumeric(reached ?? deadline) })
      : t('goalsPage.verdict.onTrack', { month: fmtMonthNumeric(reached ?? deadline) })
    if (a.monthsToDeadline <= 0) return reached
      ? t('goalsPage.verdict.overdue', { deadline: fmtMonthNumeric(deadline), reached: fmtMonthNumeric(reached) })
      : t('goalsPage.verdict.overdueNever', { deadline: fmtMonthNumeric(deadline) })
    if (meet === null || line.atDeadline === null || target === null || saving === null) return null
    const params = {
      deadline: fmtMonthNumeric(deadline), atDeadline: fmt(line.atDeadline), gap: fmt(target - line.atDeadline),
      // the saving that makes it, rounded up to the unit shown: a rounded-down one would just miss
      meet: fmt(Math.ceil(meet)), more: fmt(Math.ceil(meet) - Math.round(saving)),
    }
    if (!reached) return t('goalsPage.verdict.lateNoMove', params)
    return (
      <Trans i18nKey="goalsPage.verdict.late" values={{ ...params, reached: fmtMonthNumeric(reached) }}
        components={{ move: onMoveDeadline ? <button type="button" className="gl-link" onClick={() => onMoveDeadline(reached)} /> : <span /> }} />
    )
  }

  return (
    <section className="card gl-head">
      <div className="gl-head__top">
        <div className="gl-head__text">
          <h2 className="gl-head__name">{line.name}</h2>
          <ul className="gl-tags" aria-label={t('goalsPage.head.tags')}>
            <li className="gl-tag">{t('goalsPage.head.by', { month: fmtMonthNumeric(deadline) })}</li>
            <li className="gl-tag">{a && a.monthsToDeadline > 0 ? t('goalsPage.head.in', { span: fmtSpan(a.monthsToDeadline) }) : t('goalsPage.head.overdue')}</li>
            <li className="gl-tag">{line.item.currency}</li>
            {line.isFire && <li className="gl-tag">{t('goalsPage.head.fire')}</li>}
            {line.order !== null && <li className="gl-tag">{t('goalsPage.head.order', { n: line.order })}</li>}
          </ul>
        </div>
        {actions && <div className="gl-head__actions">{actions}</div>}
      </div>

      <dl className="gl-kpis" aria-label={t('goalsPage.kpi.figures')}>
        {kpis.map(k => (
          <div key={k.key} className="gl-kpi">
            <dt className="gl-kpi__l">{k.label}</dt>
            <dd className="gl-kpi__v num">{k.value}</dd>
            {k.meta && <dd className={`gl-kpi__m${k.tone ? ` ${k.tone}` : ''}`}>{k.meta}</dd>}
          </div>
        ))}
      </dl>

      <div className="gl-progress">
        <div className="progress-label">
          <span>{t('goalsPage.progress', { current: money(current), target: money(target) })}</span>
          <b className="num">{fmtPct(pct)}</b>
        </div>
        <ProgressTrack pct={pct} size="tall" label={t('goalsPage.progressLabel', { pct: fmtPct(pct) })} />
      </div>

      {verdict && <p className="gl-verdict">{verdict}</p>}
      {!a && <p className="gl-notice">{t('goalsPage.noRate', { currency: line.item.currency })}</p>}
      {saving === null && (
        <p className="gl-notice"><Trans i18nKey="goalsPage.notice" components={{ settings: <Link to="/settings/general" className="link-accent" /> }} /></p>
      )}
      <p className="gl-calc">
        {saving === null ? t('goalsPage.calcOff') : t('goalsPage.calc', { months })}
        {line.isFire && ` ${t('goalsPage.calcFire', { rate })}`}
      </p>
    </section>
  )
}
