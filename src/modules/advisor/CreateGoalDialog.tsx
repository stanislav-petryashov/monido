import { AdminReadNotice } from '../../pages/admin/ui/AdminReadNotice'
// An accepted save-up or goal proposal's goal, in its history row: "Create goal" opens the Goals form prefilled from the
// scenario. Nothing is written until the person presses Create; then the goal row goes in through the generic rows API (as
// the Goals screen adds one) and the proposal is linked to it. Once linked: a link to the Goals page (with the Goals module
// on), or "deleted".
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '../../components/ui/Link'
import type { ProposalView, Row } from '../../domain/api'
import { monthEnd, monthOf } from '../../domain/dates'
import { ApiError, apiSend } from '../../lib/api'
import { useToast } from '../../lib/notifyState'
import { refreshSnapshot } from '../../lib/useFinanceData'
import { amountText, parseAmount } from '../../pages/admin/amount'
import { UNREAD_DATE } from '../../pages/admin/dateMask'
import { useAdminRows } from '../../pages/admin/useAdminRows'
import { AmountInput } from '../../pages/admin/ui/AmountInput'
import { Field } from '../../pages/admin/ui/Field'
import { FormDialog } from '../../pages/admin/ui/FormDialog'
import { MonthInput } from '../../pages/admin/ui/MonthInput'
import { Select } from '../../pages/admin/ui/Select'
import { goalKey } from '../goals/goalKey'
import { proposalsQuery } from './proposalsQuery'
import { useLinkGoal } from './useProposals'

const G = 'modules.advisor.goal'
const P = 'modules.advisor.proposals'
/** A goal name's limit, as the rows API takes it */
const NAME_LIMIT = 60

/** The form's start: the goal's name (or the proposal's title for a save-up), the amount, the currency, the month's last day. */
function prefill(proposal: ProposalView) {
  const s = proposal.current.scenario
  const name = s.kind === 'goal' ? s.name : proposal.current.title
  const month = s.kind === 'goal' ? monthOf(s.targetDate) : s.kind === 'save_up' ? s.targetMonth : null
  return { name: Array.from(name).slice(0, NAME_LIMIT).join(''), amount: amountText(s.amount), currency: s.currency, date: month ? monthEnd(month) : '' }
}

/**
 * The form, once the goals it picks a free key among are read (`goals`); `onCreated` hears the new goal's key as soon as
 * the row is in, before the link (which may fail).
 */
function CreateGoalDialog({ proposal, goals, onCreated, onDone }: {
  proposal: ProposalView; goals: readonly Row[]; onCreated: (goalId: string) => void; onDone: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const link = useLinkGoal()
  const currencyRows = useAdminRows<{ code: string }>('currencies')
  const [form, setForm] = useState(() => prefill(proposal))
  const set = (change: Partial<typeof form>) => setForm(f => ({ ...f, ...change }))
  const currencies = currencyRows.rows.map(r => r.code).sort()
  // the scenario's currency stays selectable even if it left the project's list
  const options = currencies.includes(form.currency) ? currencies : [form.currency, ...currencies]

  async function submit(): Promise<boolean> {
    if (currencyRows.query.data === undefined) return false
    const fail = (text: string) => { toast.error(t(`${G}.failed`), text); return false }
    const name = form.name.trim()
    const amount = parseAmount(form.amount)
    if (!name) return fail(t(`${G}.needName`))
    if (amount.invalid || amount.value === null || amount.value <= 0) return fail(t(`${G}.needAmount`))
    if (form.date === UNREAD_DATE) return fail(t('data.common.dateUnread'))
    if (!form.date) return fail(t(`${G}.needMonth`))
    // another device may have linked a goal meanwhile: read the proposal afresh before making a second goal
    const fresh = await queryClient.fetchQuery({ ...proposalsQuery, staleTime: 0 }).catch(() => null)
    if (fresh?.proposals.find(p => p.id === proposal.id)?.goal) {
      toast.error(t(`${G}.failed`), t('errors.advisor.goal_linked'))
      onDone()
      return true
    }
    const id = goalKey({ name }, goals, false)
    const row = { id, name, target: amount.value, current: 0, target_date: monthEnd(monthOf(form.date)), currency: form.currency, emoji: null }
    let created: Row
    try {
      created = await apiSend<Row>('/api/admin/goals', 'POST', row)
    } catch (e) {
      toast.error(t(`${G}.failed`), e)
      return false
    }
    onCreated(id)
    toast.success(t(`${G}.created`), name)
    void queryClient.invalidateQueries({ queryKey: ['admin', 'goals'] })
    void refreshSnapshot(queryClient)
    // the goal exists now: the form closes even if the link fails (useLinkGoal tells it); the next press links only
    await link.mutateAsync({ id: proposal.id, goalId: id }).catch(async (e: unknown) => {
      // linked elsewhere between the read and the link: the goal just made is a duplicate, so it goes
      if (!(e instanceof ApiError && e.code === 'advisor.goal_linked')) return
      await apiSend(`/api/admin/goals/${created.rowid}`, 'DELETE').catch(() => {})
      void queryClient.invalidateQueries({ queryKey: ['admin', 'goals'] })
      void refreshSnapshot(queryClient)
    })
    onDone()
    return true
  }

  return (
    <FormDialog title={t(`${G}.title`)} description={t(`${G}.text`)} submitLabel={t(`${G}.create`)} submitDisabled={currencyRows.query.data === undefined} onSubmit={submit} onCancel={onDone}>
      <div className="form-stack">
        <AdminReadNotice queries={[currencyRows.query]} />
        <Field label={t(`${G}.name`)}>
          <input className="admin-input" maxLength={NAME_LIMIT} value={form.name} onChange={e => set({ name: e.target.value })} />
        </Field>
        <Field label={t(`${G}.target`)}>
          {/* the currency is the select below, as in the Goals form: no suffix on the amount besides it */}
          <AmountInput label={t(`${G}.target`)} value={form.amount} onChange={amount => set({ amount })} />
        </Field>
        <Field label={t('common.currency')}>
          <Select value={form.currency} onChange={e => set({ currency: e.target.value })}>
            {options.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label={t(`${G}.month`)}>
          <MonthInput label={t(`${G}.month`)} value={form.date} onChange={date => set({ date })} />
        </Field>
      </div>
    </FormDialog>
  )
}

/**
 * The goal of an accepted save-up or goal proposal: the link to it (or that it was deleted), else — for who may create one
 * — "not created yet" and Create goal. `created` is the goal already made here whose link failed: the press then links
 * it, never a second goal.
 */
export function GoalAction({ proposal, canCreateGoal, created, onCreated }: {
  proposal: ProposalView; canCreateGoal: boolean; created: string | null; onCreated: (goalId: string) => void
}) {
  const { t } = useTranslation()
  const link = useLinkGoal()
  const [open, setOpen] = useState(false)
  // read when the form is asked for: the key is picked free among them
  const goals = useAdminRows<Row>('goals', open)
  const { goal } = proposal
  if (proposal.status !== 'accepted' || (proposal.type !== 'save_up' && proposal.type !== 'goal')) return null
  if (goal) {
    if (goal.deleted) return <p className="note">{t(`${P}.goalDeleted`)}</p>
    return <p className="proposal__text"><Link to={`/goals?goal=${encodeURIComponent(goal.id)}`} className="link-accent">{t(`${P}.goalLink`)}</Link></p>
  }
  if (!canCreateGoal) return null
  // pressed, the goals still on their way: the button says so and takes no second press (it keeps the focus)
  const loading = open && !goals.loaded
  return (
    <div className="form-actions form-actions--start proposal-history__goal">
      <span className="note">{t(loading ? 'common.loading' : `${P}.goalPending`)}</span>
      <button type="button" className="btn btn--muted" aria-disabled={loading || link.isPending || undefined} aria-busy={loading || link.isPending || undefined}
        onClick={() => {
          if (loading || link.isPending) return
          if (created) link.mutate({ id: proposal.id, goalId: created })
          else setOpen(true)
        }}>{t(`${P}.createGoal`)}</button>
      {open && <AdminReadNotice queries={[goals.query]} />}
      {open && goals.query.data !== undefined && <CreateGoalDialog proposal={proposal} goals={goals.rows} onCreated={onCreated} onDone={() => setOpen(false)} />}
    </div>
  )
}
