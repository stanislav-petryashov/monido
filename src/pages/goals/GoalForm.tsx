import { Trans, useTranslation } from 'react-i18next'
import type { PlanPreview } from '../../domain/goals'
import { Link } from '../../components/ui/Link'
import { Switch } from '../../components/ui/Switch'
import { fmtDayNumeric, fmtMonthNumeric } from '../../lib/formatters'
import type { ComponentProps } from 'react'
import { AmountInput } from '../admin/ui/AmountInput'
import { Field } from '../admin/ui/Field'
import { MonthInput } from '../admin/ui/MonthInput'
import { OptionPicker } from '../admin/ui/OptionPicker'
import '../../styles/admin.css'

/** A goal's form as typed: amounts as canonical text, the month as an ISO day, `fire` 'on' while the switch is on */
export type GoalFields = Record<'name' | 'target' | 'current' | 'target_date' | 'currency' | 'fire', string>

/** «In 1 year / 5 / 10 years» under the month */
const MONTH_CHIPS = [1, 5, 10]

/** Both goal editors share the input types, month shortcuts and validation presentation. */
export function GoalInput({ field, ...props }: Pick<ComponentProps<typeof AmountInput>, 'label' | 'value' | 'onChange' | 'autoFocus' | 'invalid' | 'submitted' | 'aria-labelledby' | 'aria-describedby'> & { field: 'name' | 'target' | 'current' | 'target_date' }) {
  if (field === 'target_date') return <MonthInput {...props} chips={MONTH_CHIPS} />
  if (field !== 'name') return <AmountInput {...props} />
  const { label, value, onChange, invalid, autoFocus, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy } = props
  return <input autoFocus={autoFocus} aria-labelledby={labelledBy} aria-describedby={describedBy} className="admin-input" aria-label={label} value={value} aria-invalid={invalid || undefined} onChange={e => onChange(e.target.value)} />
}

interface GoalFieldInputsProps {
  data: GoalFields
  setData: (change: Partial<GoalFields>) => void
  currencies: string[]
  /** The stored month, for «was …» under the field; null — a new goal */
  wasMonth: string | null
  /** The switch: shown while no other goal is independence; the other goal's name otherwise */
  fire: { offered: true } | { offered: false; other: string | null }
  /** Focus «Already saved» first («Update saved») */
  focusSaved?: boolean
  submitted: boolean
}

/** The goal's fields: name, target, saved, currency, the month with «In 1 / 5 / 10 years», and the independence switch. */
export function GoalFieldInputs({ data, setData, currencies, wasMonth, fire, focusSaved = false, submitted }: GoalFieldInputsProps) {
  const { t } = useTranslation()
  const unit = data.currency || undefined
  const options = (currencies.includes(data.currency) || !data.currency ? currencies : [...currencies, data.currency]).map(c => ({ value: c, label: c }))
  return (
    <>
      <div className="gl-form__grid">
        <div className="gl-form__wide">
          <Field label={t('goalsPage.form.name')} error={submitted && !data.name.trim() ? t('goalsPage.form.needName') : undefined}>
            <GoalInput field="name" label={t('goalsPage.form.name')} value={data.name} autoFocus={!focusSaved} invalid={submitted && !data.name.trim()} onChange={name => setData({ name })} />
          </Field>
        </div>
        <Field label={t('goalsPage.form.target')} unit={unit}>
          <GoalInput field="target" label={t('goalsPage.form.target')} value={data.target} onChange={v => setData({ target: v })} submitted={submitted} invalid={submitted && !data.target.trim()} />
        </Field>
        <Field label={t('goalsPage.form.current')} unit={unit} hint={t('goalsPage.form.currentHint', { date: fmtDayNumeric(new Date().toISOString().slice(0, 10)) })}>
          <GoalInput field="current" label={t('goalsPage.form.current')} value={data.current} onChange={v => setData({ current: v })} autoFocus={focusSaved} submitted={submitted} />
        </Field>
      </div>
      <div className="gl-form__grid">
        <Field label={t('goalsPage.form.currency')} group>
          <OptionPicker options={options} value={data.currency} onChange={v => setData({ currency: v })} />
        </Field>
        <div className="gl-form__wide">
          <Field label={t('goalsPage.form.month')} hint={wasMonth ? t('goalsPage.form.monthWas', { month: fmtMonthNumeric(wasMonth) }) : undefined}>
            <GoalInput field="target_date" label={t('goalsPage.form.month')} value={data.target_date} onChange={v => setData({ target_date: v })} invalid={submitted && !data.target_date} />
          </Field>
        </div>
      </div>
      {fire.offered ? (
        <label className="switch-field">
          <Switch checked={data.fire === 'on'} label={t('goalsPage.form.fire')} onChange={on => setData({ fire: on ? 'on' : '' })} />
          <span>{t('goalsPage.form.fire')}</span>
        </label>
      ) : fire.other && <p className="note">{t('goalsPage.form.fireTaken', { name: fire.other })}</p>}
    </>
  )
}

interface WhatHappensProps {
  preview: PlanPreview | null
  currency: string
  /** The need before the change; null — a new goal (its place in the queue is said instead) */
  was: number | null
  fmt: (v: number) => string
  /** «Ask the Advisor» (the dialog), shown while the advisor's page is there */
  ask?: boolean
}

/** «What happens»: the draft's need, what it gets and when it is reached, and the other goals whose months move — live from planPreview. */
export function WhatHappens({ preview, currency, was, fmt, ask = false }: WhatHappensProps) {
  const { t } = useTranslation()
  if (!preview) return null
  const lines: { key: string; text: string; tone?: string }[] = []
  if (preview.noRate) lines.push({ key: 'rate', text: t('goalsPage.preview.noRate', { currency }) })
  else {
    lines.push({ key: 'need', text: was === null ? `${t('goalsPage.preview.order', { n: preview.order })} ${t('goalsPage.preview.need', { need: fmt(preview.need) })}` : t('goalsPage.preview.needWas', { need: fmt(preview.need), was: fmt(was) }) })
    const p = preview.plan
    if (!p) lines.push({ key: 'unknown', text: t('goalsPage.preview.unknown') })
    else {
      const later = p.steps.later
      lines.push({
        key: 'gets',
        text: p.steps.now > 0
          ? (later ? t('goalsPage.preview.getsLater', { now: fmt(p.steps.now), later: fmt(later.perMonthBase), month: fmtMonthNumeric(later.month) }) : t('goalsPage.preview.gets', { now: fmt(p.steps.now) }))
          : later ? t('goalsPage.preview.getsFrom', { month: fmtMonthNumeric(later.month), later: fmt(later.perMonthBase) }) : t('goalsPage.preview.getsNone'),
      })
      lines.push(p.status === 'on_track' || p.status === 'done'
        ? { key: 'status', text: t('goalsPage.preview.onTrack', { month: fmtMonthNumeric(p.projectedDate ?? '') }), tone: 'gl-ok' }
        : p.projectedDate ? { key: 'status', text: t('goalsPage.preview.late', { month: fmtMonthNumeric(p.projectedDate) }), tone: 'gl-late' }
          : { key: 'status', text: t('goalsPage.preview.never'), tone: 'gl-late' })
    }
  }
  const moves = !preview.noRate && preview.plan ? preview.plan.moves : null
  return (
    <div className="gl-preview" aria-live="polite">
      <span className="gl-preview__h">{t(was === null ? 'goalsPage.preview.title' : 'goalsPage.preview.titleEdit')}</span>
      <p className="gl-preview__r">{lines.map(l => <span key={l.key} className={l.tone}>{l.text} </span>)}</p>
      {moves && (moves.length === 0 ? <p className="gl-preview__o">{t('goalsPage.preview.none')}</p> : (
        <ul className="gl-preview__o">
          {moves.map(m => (
            <li key={m.goalId}>{m.startBefore !== m.startAfter && m.startAfter
              ? t('goalsPage.preview.moveStart', { name: m.name, start: fmtMonthNumeric(m.startAfter), was: m.startBefore ? fmtMonthNumeric(m.startBefore) : '—', month: m.after ? fmtMonthNumeric(m.after) : '—' })
              : m.after ? t('goalsPage.preview.moveMonth', { name: m.name, after: fmtMonthNumeric(m.after), before: m.before ? fmtMonthNumeric(m.before) : '—' })
                : t('goalsPage.preview.moveNever', { name: m.name, before: m.before ? fmtMonthNumeric(m.before) : '—' })}</li>
          ))}
        </ul>
      ))}
      {ask && <p className="gl-preview__o"><Trans i18nKey="goalsPage.preview.ask" components={{ ask: <Link to="/advisor/ask" className="link-accent" /> }} /></p>}
    </div>
  )
}
