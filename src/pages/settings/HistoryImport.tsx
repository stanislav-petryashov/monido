import { useId, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ACCOUNT_CLASSES } from '../../domain/accounts'
import type { HistoryAccount, HistoryProblem } from '../../domain/historyImport'
import { apiSend } from '../../lib/api'
import { useAuth } from '../../lib/authState'
import { useFamilyCurrency } from '../../lib/familySettings'
import { classLabel, fmtMonth } from '../../lib/formatters'
import { historyTemplate, parseHistorySheet, type DecimalMark, type SheetProblem, type SheetResult } from '../../lib/historySheet'
import { useConfirm } from '../../lib/notifyState'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { useCan } from '../../lib/rights'
import { monthCloseQuery, useSnapshotWrite } from '../admin/adminQuery'
import { Select } from '../admin/ui/Select'
import { SettingsSection } from '../admin/ui/SettingsSection'

interface Preview { months: string[]; balances: number; closures: number; newAccounts: number; problems: HistoryProblem[]; sent: string }
const WRITES = [monthCloseQuery.queryKey]

/**
 * Settings → Data → "Import history": the months before the wizard from a pasted or uploaded sheet of month-end
 * balances (src/lib/historySheet.ts reads it in the browser), each column matched to an account, checked by the server
 * (a dry run) before the import; the imported months are removed together. Hidden in the demo and without the edit right.
 */
export function HistoryImport() {
  const { t } = useTranslation()
  const demo = useAuth().mode === 'demo'
  const canEdit = useCan('edit')
  const familyCurrency = useFamilyCurrency()
  const state = useQuery({ ...monthCloseQuery, enabled: !demo && canEdit })
  const write = useSnapshotWrite(WRITES)
  const confirm = useConfirm()
  const { hidden } = usePrivacy()
  const textId = useId()
  const [text, setText] = useState('')
  const [decimal, setDecimal] = useState<DecimalMark | undefined>()
  const [result, setResult] = useState<SheetResult | null>(null)
  const [accounts, setAccounts] = useState<HistoryAccount[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  if (demo || !canEdit || !state.data) return null
  const { history, members, currencies } = state.data
  // a name two recorded accounts share is told apart by its owner, in the template's header and when a sheet is read
  const shared = new Set(history.accounts.map(a => a.name).filter((name, i, all) => all.indexOf(name) !== i))
  const labelOf = (a: { name: string; member: string }) => (shared.has(a.name) ? `${a.name} (${a.member || t('data.history.noMember')})` : a.name)

  function read(next: string, mark = decimal) {
    setText(next)
    setPreview(null)
    const r = next.trim() ? parseHistorySheet(next, mark) : null
    setResult(r)
    // a column named like a recorded account is that account; a new one starts as a bank account in the sheet's or the family's currency
    setAccounts((r?.sheet?.accounts ?? []).map((name, i) => {
      const known = history.accounts.find(a => labelOf(a) === name.trim()) ?? history.accounts.find(a => a.name === name.trim())
      const currency = r?.sheet?.currencies[i] ?? (currencies.includes(familyCurrency) ? familyCurrency : currencies[0] ?? '')
      return known ? { ...known } : { name: name.trim(), member: '', class: 'bank', currency }
    }))
  }
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) read(await file.text())
  }
  const edit = (i: number, change: Partial<HistoryAccount>) => {
    setPreview(null)
    setAccounts(list => list.map((a, j) => (j === i ? { ...a, ...change } : a)))
  }
  const body = result?.sheet ? { accounts, months: result.sheet.months } : null
  const sent = body ? JSON.stringify(body) : ''
  const ready = !!body && !!preview && preview.sent === sent && preview.problems.length === 0 && result?.problems.length === 0 && result.decimal !== 'ambiguous'

  async function check() {
    if (!body) return
    setBusy(true)
    await write(async () => setPreview({ ...await apiSend<Omit<Preview, 'sent'>>('/api/month-close/history/preview', 'POST', body), sent }), null, t('data.history.checkFailed'))
    setBusy(false)
  }
  async function run() {
    if (!ready || !body) return
    setBusy(true)
    const done = await write(() => apiSend('/api/month-close/history', 'POST', body), t('data.history.imported', { count: preview.months.length }), t('data.history.importFailed'))
    setBusy(false)
    if (done) read('')
  }
  async function remove() {
    if (!history.imported) return
    const span = { first: fmtMonth(history.imported.first), last: fmtMonth(history.imported.last) }
    if (!await confirm({ title: t('data.history.removeTitle'), text: t('data.history.removeText', span), confirmLabel: t('data.history.remove'), tone: 'danger' })) return
    setBusy(true)
    await write(() => apiSend('/api/month-close/history', 'DELETE'), t('data.history.removed'), t('data.history.removeFailed'))
    setBusy(false)
  }

  // the recorded accounts as columns (two examples without any), the twelve months the import may end with
  function template() {
    const names = history.accounts.length ? history.accounts.map(labelOf) : [t('data.history.exampleBank'), t('data.history.exampleBroker')]
    const csv = historyTemplate(t('data.history.monthColumn'), names, history.endsAt ?? history.until)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'monido-history.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const rule = history.endsAt ? t('data.history.endsAt', { month: fmtMonth(history.endsAt) }) : t('data.history.until', { month: fmtMonth(history.until) })
  return (
    <SettingsSection title={t('data.history.title')} description={t('data.history.text')}>
      <div className="history-import">
        {history.imported && (
          <div className="data-task">
            <p className="note">{t('data.history.importedSpan', { first: fmtMonth(history.imported.first), last: fmtMonth(history.imported.last) })}</p>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void remove()}>{t('data.history.remove')}</button>
          </div>
        )}
        <p className="note">{rule}</p>
        {!hidden && <label className="history-import__label" htmlFor={textId}>{t('data.history.paste')}</label>}
        {/* privacy mode hides the pasted amounts; the sheet stays as it was pasted */}
        {hidden
          ? <p id={textId} className="note">{t(text ? 'data.history.hiddenPasted' : 'data.history.hidden')}</p>
          : <textarea id={textId} className="admin-input history-import__text" rows={6} value={text} spellCheck={false}
          placeholder={t('data.history.placeholder')} onChange={e => read(e.target.value)} />}
        <div className="form-actions form-actions--start">
          <label className="btn btn--ghost">
            {t('data.history.file')}
            <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="sr-only" onChange={e => void pick(e)} />
          </label>
          <button type="button" className="btn btn--ghost" onClick={template}>{t('data.history.template')}</button>
        </div>

        {result && <SheetProblems problems={result.problems} />}
        {result?.decimal === 'ambiguous' && (
          <label className="history-import__decimal">
            {t('data.history.decimalAsk')}
            <Select value={decimal ?? ''} onChange={e => { const mark = (e.target.value || undefined) as DecimalMark | undefined; setDecimal(mark); read(text, mark) }}>
              <option value="">—</option>
              <option value=",">{t('data.history.decimalComma')}</option>
              <option value=".">{t('data.history.decimalDot')}</option>
            </Select>
          </label>
        )}

        {result?.sheet && accounts.length > 0 && (
          <div className="history-import__table" role="group" aria-label={t('data.history.accounts')}>
            <table className="admin-table">
              <thead><tr>
                <th scope="col">{t('data.history.column')}</th><th scope="col">{t('data.field.name')}</th>
                <th scope="col">{t('data.field.member')}</th><th scope="col">{t('data.field.type')}</th><th scope="col">{t('common.currency')}</th>
              </tr></thead>
              <tbody>
                {accounts.map((a, i) => (
                  <tr key={i}>
                    <td>{result.sheet!.accounts[i]}</td>
                    <td><input className="admin-input" aria-label={t('data.field.name')} value={a.name} onChange={e => edit(i, { name: e.target.value })} /></td>
                    <td><Select aria-label={t('data.field.member')} value={a.member} onChange={e => edit(i, { member: e.target.value })}>
                      <option value="">{t('data.history.noMember')}</option>
                      {members.map(m => <option key={m} value={m}>{m}</option>)}
                    </Select></td>
                    <td><Select aria-label={t('data.field.type')} value={a.class} onChange={e => edit(i, { class: e.target.value })}>
                      {ACCOUNT_CLASSES.map(c => <option key={c} value={c}>{classLabel(c)}</option>)}
                    </Select></td>
                    <td><Select aria-label={t('common.currency')} value={a.currency} onChange={e => edit(i, { currency: e.target.value })}>
                      {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                    </Select></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {preview && preview.sent === sent && (preview.problems.length
          ? <ImportProblems problems={preview.problems} />
          : <p className="note" role="status">{t('data.history.summary', {
            count: preview.months.length, first: fmtMonth(preview.months[0]), last: fmtMonth(preview.months[preview.months.length - 1]),
            balances: preview.balances, accounts: preview.newAccounts, closures: preview.closures,
          })}</p>)}

        {result?.sheet && (
          <div className="form-actions form-actions--start">
            <button type="button" className="btn btn--ghost" disabled={busy || result.problems.length > 0 || result.decimal === 'ambiguous'} onClick={() => void check()}>{t('data.history.check')}</button>
            <button type="button" className="btn btn--primary" disabled={busy || !ready} onClick={() => void run()}>{t('data.history.import')}</button>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}

/** What the browser could not read in the sheet, in words */
function SheetProblems({ problems }: { problems: SheetProblem[] }) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  if (!problems.length) return null
  return (
    <ul className="history-import__problems" role="alert">
      {problems.slice(0, 10).map((p, i) => <li key={i}>{t(`data.history.sheet.${p.code}`, { ...p, ...('text' in p && hidden ? { text: PRIVACY_MASK } : {}) })}</li>)}
      {problems.length > 10 && <li>{t('data.history.more', { count: problems.length - 10 })}</li>}
    </ul>
  )
}

/** Why the server would not import the sheet, in words */
function ImportProblems({ problems }: { problems: HistoryProblem[] }) {
  const { t } = useTranslation()
  const params = (p: HistoryProblem) => Object.fromEntries(Object.entries(p.params ?? {}).map(([k, v]) => [k, k === 'month' && typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? fmtMonth(v) : v]))
  return (
    <ul className="history-import__problems" role="alert">
      {problems.slice(0, 10).map((p, i) => <li key={i}>{t(`data.history.problem.${p.code}`, params(p))}</li>)}
      {problems.length > 10 && <li>{t('data.history.more', { count: problems.length - 10 })}</li>}
    </ul>
  )
}
