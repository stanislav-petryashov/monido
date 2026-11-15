import { PageError } from '../../components/PageError'
import { Loading } from '../../components/ui/Loading'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Translate } from '../../i18n/core'
import { errorMessage } from '../../i18n/client'
import { START_DAY_MAX, isTimezone, localTime, type Schedule } from './domain'
import { fmtDay } from '../../lib/formatters'
import { useToast } from '../../lib/notifyState'
import type { RemindersRequest, RemindersView } from '../../domain/api'
import { remindersQuery } from './remindersQuery'
import { Switch } from '../../components/ui/Switch'
import { Notice } from '../../components/ui/Notice'
import { Field } from '../../pages/admin/ui/Field'
import { apiSend } from '../../lib/api'
import { useCan } from '../../lib/rights'
import { Select } from '../../pages/admin/ui/Select'

const DAYS = Array.from({ length: START_DAY_MAX }, (_, i) => i + 1)
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const clock = (hour: number, minute = 0) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

/** Zones the browser knows — suggestions for the field; old browsers go without them. */
const ZONES: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []

/** A write to /api/reminders*: its answer is the new view; ok and fail are the notification titles */
interface Write {
  url: string
  method: 'PUT' | 'POST' | 'DELETE'
  body?: RemindersRequest
  ok: string
  fail: string
}

/** “October 3, 10:05” in the schedule's time zone — not the browser's; nothing with a broken zone. */
function sentAt(iso: string, timezone: string): string | null {
  if (!isTimezone(timezone)) return null
  const at = new Date(iso)
  const minute = Number(new Intl.DateTimeFormat('en', { timeZone: timezone, minute: 'numeric' }).format(at))
  const local = localTime(at, timezone)
  return `${fmtDay(local.date)}, ${clock(local.hour, minute)}`
}

/** How often the zone's clock under the field is read again: it shows minutes */
const CLOCK_TICK_MS = 30_000

/** The time now, read again every CLOCK_TICK_MS while the component is shown */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** “UTC+5” / “UTC−3:30” of a valid zone at `at`, and its clock time “14:05” */
function zoneNow(timezone: string, at = new Date()): { offset: string; time: string } | null {
  if (!isTimezone(timezone)) return null
  const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' }).formatToParts(at).find(p => p.type === 'timeZoneName')?.value ?? 'GMT'
  const minute = Number(new Intl.DateTimeFormat('en', { timeZone: timezone, minute: 'numeric' }).format(at))
  return { offset: name.replace('GMT', 'UTC').replace('-', '\u2212'), time: clock(localTime(at, timezone).hour, minute) }
}

function stateLine(t: Translate, view: RemindersView): string {
  const { settings } = view
  if (!settings.enabled) return t('modules.reminders.off')
  if (!view.linked) return t('modules.reminders.noChat')
  if (!isTimezone(settings.timezone)) return t('modules.reminders.badZone')
  if (view.openMonths.length === 0) return t('modules.reminders.allClosed')
  return view.next ? t('modules.reminders.next', { day: fmtDay(view.next.date), time: clock(view.next.hour, view.next.minute), zone: settings.timezone }) : ''
}

/** What the form edits: the schedule. */
type Form = Schedule

const formOf = (view: RemindersView): Form => {
  const { enabled, startDay, hour, timezone } = view.settings
  return { enabled, startDay, hour, timezone }
}
const same = (a: Form, b: Form) =>
  a.enabled === b.enabled && a.startDay === b.startDay && a.hour === b.hour && a.timezone === b.timezone

/** Until anything is set up, the form offers the browser's zone instead of the default UTC */
const untouched = (view: RemindersView) =>
  view.settings.timezone === 'UTC' && !view.settings.enabled && !view.linked && view.settings.lastSentAt === null

/** Reminder settings under the module card on the Modules page: chat binding, schedule, test message. */
export function RemindersBlock() {
  const { t } = useTranslation()
  const reminders = useQuery(remindersQuery)
  const canManage = useCan('manage')
  const [mountedAt] = useState(() => Date.now())
  // the screen's own read decides: an answer cached on an earlier visit is not shown as the current one
  if (!reminders.isFetchedAfterMount) return <Loading className="reminder-state" />
  // a failed re-read keeps settings read on this visit; an answer cached before it is not shown as the current one
  if (!reminders.data || (reminders.isError && reminders.dataUpdatedAt < mountedAt)) return <PageError className="reminder-state">{t('modules.reminders.loadFailed')}</PageError>
  // the schedule is a setting of the family: others see what will happen, not the form
  if (!canManage) return <p className="reminder-state">{stateLine(t, reminders.data)}</p>
  return <RemindersForm view={reminders.data} />
}

/** The settings of a configured bot; the form starts from the view it was mounted with. */
function RemindersForm({ view }: { view: RemindersView }) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  /** The browser's zone replaced the default UTC and is not saved yet */
  const [suggested, setSuggested] = useState(() => untouched(view))
  const [form, setForm] = useState<Form>(() =>
    suggested ? { ...formOf(view), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : formOf(view))
  const [zoneError, setZoneError] = useState(false)
  const zoneErrorId = useId()
  const zoneHintId = useId()
  const clockNow = useClock()
  const send = useMutation({
    mutationFn: ({ url, method, body }: Write) => apiSend<RemindersView>(url, method, body),
    // the answer is the new view
    onSuccess: (next, { ok }) => {
      queryClient.setQueryData(remindersQuery.queryKey, next)
      toast.success(ok)
    },
    onError: (e, { fail }) => toast.error(fail, e),
  })
  const busy = send.isPending
  /**
   * A write to the server. Only saving touches the schedule form: binding a chat or a test
   * message must not reset what the person chose but has not saved yet.
   */
  async function act(write: Write, saved = false) {
    const next = await send.mutateAsync(write).catch(() => null)
    if (next && saved) { setForm(formOf(next)); setSuggested(false) }
  }

  function save() {
    if (!isTimezone(form.timezone)) return setZoneError(true)
    void act({ url: '/api/reminders', method: 'PUT', body: form, ok: t('modules.reminders.saved'), fail: t('modules.reminders.saveFailed') }, true)
  }

  function detect() {
    setZoneError(false)
    setSuggested(false)
    setForm(f => ({ ...f, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }))
  }

  const { settings } = view
  const now = zoneNow(form.timezone, clockNow)
  const changed = !same(form, formOf(view)) && !(suggested && same({ ...form, timezone: 'UTC' }, formOf(view)))
  const last = settings.lastSentAt ? sentAt(settings.lastSentAt, settings.timezone) : null
  return (
    <>
      <div className="reminder-form">
        <div className="family-toggle"><span>{t('notifications.remind')}</span><Switch checked={form.enabled} label={t('notifications.remind')} disabled={busy} onChange={enabled => setForm(f => ({ ...f, enabled }))} /></div>
        <div className="form-grid">
          <Field variant="inset" label={t('modules.reminders.startDay')}>
            <Select disabled={busy} value={form.startDay} onChange={e => setForm(f => ({ ...f, startDay: Number(e.target.value) }))}>
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field variant="inset" label={t('modules.reminders.hour')}>
            <Select disabled={busy} value={form.hour} onChange={e => setForm(f => ({ ...f, hour: Number(e.target.value) }))}>
              {HOURS.map(h => <option key={h} value={h}>{clock(h)}</option>)}
            </Select>
          </Field>
          <div className="reminder-zone">
            <div className="reminder-zone__row">
              <Field variant="inset" label={t('modules.reminders.timezone')}>
                <input
                  disabled={busy} className="admin-input" list="reminder-zones" value={form.timezone} aria-invalid={zoneError || undefined}
                  aria-describedby={[zoneHintId, zoneError ? zoneErrorId : ''].filter(Boolean).join(' ')}
                  onChange={e => { setSuggested(false); setZoneError(false); setForm(f => ({ ...f, timezone: e.target.value.trim() })) }}
                />
              </Field>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={detect}>{t('modules.reminders.detect')}</button>
            </div>
            <span id={zoneHintId} className="field__hint">
              {now ? t('modules.reminders.zoneNow', now) : t('modules.reminders.timezoneHint')}
            </span>
          </div>
        </div>
        <datalist id="reminder-zones">{ZONES.map(z => <option key={z} value={z} />)}</datalist>
        {zoneError && <p id={zoneErrorId} className="close-foot__error" role="alert">{t('modules.reminders.zoneError')}</p>}
        <p className="field__hint">{t('modules.reminders.repeats')}</p>
        {changed && <div className="form-actions">
          <button className="btn btn--ghost" disabled={busy} onClick={() => { setForm(formOf(view)); setSuggested(false); setZoneError(false) }}>{t('common.cancel')}</button>
          <button className="btn btn--primary" disabled={busy} onClick={save}>{t('data.common.save')}</button>
        </div>}
        {changed && <Notice tone="neutral">{t('modules.reminders.unsaved')}</Notice>}
      </div>

      <Notice tone={!view.configured || settings.lastError ? 'warning' : 'neutral'}>

        {settings.lastError
          ? <span className="close-foot__error">{t('modules.reminders.lastError', { error: errorMessage(settings.lastError.code, settings.lastError.params, t('modules.reminders.sendFailed')) })}{' '}</span>
          : last && <>{t('modules.reminders.lastSent', { at: last })}{' '}</>}
        {!view.configured ? t('notifications.connectFirst') : stateLine(t, view)}
      </Notice>
    </>
  )
}
