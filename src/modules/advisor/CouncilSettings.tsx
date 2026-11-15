import { PageError } from '../../components/PageError'
import { Loading } from '../../components/ui/Loading'
// The proposal settings, for who may manage settings: the days the family has to decide and the reminder before the
// deadline (PUT /api/advisor/settings; only where the council works).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '../../components/ui/Switch'
import type { AdvisorSettings } from '../../domain/api'
import { useToast } from '../../lib/notifyState'
import { useCan } from '../../lib/rights'
import { Field } from '../../pages/admin/ui/Field'
import { NumberInput } from '../../pages/admin/ui/NumberInput'
import { Disclosure } from '../../components/ui/Disclosure'
import { fmtNum } from '../../lib/formatters'
import { useProposals, useSaveCouncilSettings } from './useProposals'

const S = 'modules.advisor.settings'
/** The reminder's days when it is switched on again from off */
const REMIND_DEFAULT = '3'

/** A whole number from the field, or null. */
const whole = (text: string): number | null => (/^\d+$/.test(text) ? Number(text) : null)

/** The form's fields as the stored settings fill them. */
const fieldsOf = (settings: AdvisorSettings) => ({
  decide: String(settings.decideDays),
  remind: settings.remindDays !== null,
  remindDays: settings.remindDays === null ? REMIND_DEFAULT : String(settings.remindDays),
})

/**
 * Days to decide, the reminder switch and its days, Save; the server checks the ranges and that the reminder comes first.
 * New stored settings (a save, another manager's) start the fields again in place: the form is not mounted anew, so the
 * keyboard focus stays where it was.
 */
function DaysForm({ settings }: { settings: AdvisorSettings }) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSaveCouncilSettings()
  const stored = fieldsOf(settings)
  const [decide, setDecide] = useState(stored.decide)
  const [remind, setRemind] = useState(stored.remind)
  const [remindDays, setRemindDays] = useState(stored.remindDays)
  const [shown, setShown] = useState(settings)
  if (shown.decideDays !== settings.decideDays || shown.remindDays !== settings.remindDays) {
    setShown(settings)
    setDecide(stored.decide)
    setRemind(stored.remind)
    setRemindDays(stored.remindDays)
  }

  function submit() {
    if (save.isPending) return
    const decideDays = whole(decide)
    const before = remind ? whole(remindDays) : null
    if (decideDays === null || (remind && before === null)) { toast.error(t('modules.advisor.proposals.settingsFailed'), t('data.common.notNumber')); return }
    save.mutate({ decideDays, remindDays: before })
  }

  return (
    <>
      <div className="form-stack">
        <Field label={t(`${S}.decideDays`)} hint={t(`${S}.decideHint`)}>
          <NumberInput label={t(`${S}.decideDays`)} value={decide} onChange={setDecide} decimals={0} />
        </Field>
        <label className="switch-field">
          <Switch checked={remind} label={t(`${S}.remind`)} onChange={setRemind} />
          <span>{t(`${S}.remind`)}</span>
        </label>
        {remind && (
          <Field label={t(`${S}.remindDays`)} hint={t(`${S}.remindHint`)}>
            <NumberInput label={t(`${S}.remindDays`)} value={remindDays} onChange={setRemindDays} decimals={0} />
          </Field>
        )}
      </div>
      <div className="form-actions form-actions--start">
        {/* aria-disabled, not disabled, while saving: a disabled button would drop the keyboard focus */}
        <button type="button" className="btn btn--primary" aria-disabled={save.isPending || undefined} onClick={submit}>{t('data.common.save')}</button>
      </div>
    </>
  )
}

export function CouncilSettings() {
  const { t } = useTranslation()
  const canManage = useCan('manage')
  const proposals = useProposals()
  if (!canManage) return null
  const data = proposals.data
  // no council here (not Telegram sign-in): its days mean nothing
  if (data?.available === false) return null
  return (
    <section aria-label={t(`${S}.title`)}>
      <Disclosure className="council-fold" title={t(`${S}.title`)} eager open={proposals.isError ? true : undefined} hint={data ? t(data.settings.remindDays === null ? `${S}.summaryOff` : `${S}.summary`, {
        days: fmtNum(data.settings.decideDays, 0), remind: fmtNum(data.settings.remindDays ?? 0, 0),
      }) : undefined}>
      <p className="council-description">{t(`${S}.text`)}</p>
      <div className="council-form">
      {data ? <DaysForm settings={data.settings} />
        : proposals.isError ? <PageError className="reminder-state" />
          : <Loading className="reminder-state" />}
    </div></Disclosure>
    </section>
  )
}
