import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { fmtDayTime } from '../../lib/formatters'
import { currentLanguage } from '../../i18n/client'
import { Chip } from '../../components/ui/Chip'
import { PageError } from '../../components/PageError'
import { apiSend } from '../../lib/api'
import { reloadFamilySettings } from '../../lib/familySettings'
import type { ChangeEntry } from '../../domain/api'
import { isRevertible, journalActor, journalLine, journalTableName, journalSummary, journalUndoEffect, journalDetails } from './journal'
import { useConfirm } from '../../lib/notifyState'
import { tableQuery, useAdminWrite, useLoadFailedToast } from './adminQuery'
import { useCan } from '../../lib/rights'
import { usePrivacy } from '../../lib/privacy'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import { Select } from './ui/Select'
import '../settings/settings-navigation.css'
import './journal.css'
import { Loading } from '../../components/ui/Loading'
import { Disclosure } from '../../components/ui/Disclosure'

function operationColor(op: string) {
  return op === 'insert' ? 'success' : op === 'update' ? 'primary' : op === 'delete' || op === 'wipe' ? 'error' : 'secondary'
}

/** The change_log rows under the journal's own key */
const journalQuery = queryOptions({ ...tableQuery<ChangeEntry>('change_log'), queryKey: ['admin', 'journal'] })
/** A revert rewrites a row of any table and adds a journal entry: everything under 'admin' is stale */
const WRITES = [['admin']]

export function JournalView() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const canEdit = useCan('edit')
  const canManage = useCan('manage')
  const { hidden } = usePrivacy()
  const journal = useQuery(journalQuery)
  useLoadFailedToast(journal)
  const write = useAdminWrite(WRITES)
  const queryClient = useQueryClient()
  const [object, setObject] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState<number | null>(null)

  async function revert(entry: ChangeEntry) {
    if (!(await confirm({ title: t('data.journal.human.undoTitle'), text: journalUndoEffect(entry, hidden), confirmLabel: t('data.journal.revert'), tone: 'warning' }))) return
    setBusy(entry.id)
    const ok = await write(() => apiSend(`/api/admin/change_log/${entry.id}/revert`, 'POST'), t('data.journal.human.undone', { change: journalSummary(entry, hidden, true) }), t('data.journal.revertFailed'))
    // a family setting changed back: the UI language and the snapshot's default currency follow at once, not on a reload
    if (ok && entry.table_name === 'app_settings') await reloadFamilySettings(queryClient)
    setBusy(null)
  }

  if (!journal.data) return journal.isError ? <PageError onRetry={() => void journal.refetch()} retrying={journal.isFetching} /> : <Loading />
  const entries = journal.data.rows
  if (!entries.length) return <div className="general-settings journal-sheet empty"><p className="empty__title">{t('data.journal.empty')}</p><p>{t('data.journal.emptyText')}</p></div>
  const objects = [...new Set(entries.map(entry => entry.table_name))].sort((a, b) => journalTableName(a).localeCompare(journalTableName(b)))
  const authors = [...new Set(entries.map(entry => entry.actor))].sort((a, b) => a.localeCompare(b))
  const visible = entries.filter(entry => (!object || entry.table_name === object) && (!author || entry.actor === author))
  // Revert eligibility uses the complete history even when the entry that reverted it is filtered out.
  const reverted = new Set(entries.map(e => e.reverts_id).filter((id): id is number => id !== null))

  const summary = (entry: ChangeEntry) => {
    const original = entry.op === 'revert' ? entries.find(e => e.id === entry.reverts_id) : undefined
    return original ? t('data.journal.human.undone', { change: journalSummary(original, hidden, true) }) : journalSummary(entry, hidden, true)
  }

  const dateFormat = new Intl.DateTimeFormat(currentLanguage(), { day: 'numeric', month: 'long', year: 'numeric' })
  const timeFormat = new Intl.DateTimeFormat(currentLanguage(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const days = new Map<string, ChangeEntry[]>()
  for (const entry of visible) {
    const date = new Date(entry.ts)
    const day = Number.isNaN(date.getTime()) ? entry.ts : dateFormat.format(date)
    const rows = days.get(day) ?? []
    rows.push(entry)
    days.set(day, rows)
  }

  return (
    <div className="general-settings journal-sheet">
      <ViewOnlyNote right="edit" />
      <div className="journal-filters">
        <label className="field"><span className="field__label">{t('ux.journalObject')}</span><Select value={object} onChange={event => setObject(event.target.value)}>
          <option value="">{t('ux.allObjects')}</option>
          {objects.map(table => <option key={table} value={table}>{journalTableName(table)}</option>)}
        </Select></label>
        <label className="field"><span className="field__label">{t('data.journal.who')}</span><Select value={author} onChange={event => setAuthor(event.target.value)}>
          <option value="">{t('ux.allAuthors')}</option>
          {authors.map(name => <option key={name} value={name}>{journalActor(entries.find(entry => entry.actor === name)!)}</option>)}
        </Select></label>
        {(object || author) && <button className="btn btn--quiet" onClick={() => { setObject(''); setAuthor('') }}>{t('data.journal.resetFilters')}</button>}
      </div>
      {visible.length === 0 && <p role="status" className="empty">{t('ux.noMatchingChanges')}</p>}
      {[...days].map(([day, rows]) => <section className="journal-day" key={day} aria-label={day}>
        <h2>{day}</h2>
        {rows.map(e => {
          const date = new Date(e.ts)
          const operation = ['insert', 'update', 'delete', 'revert', 'restore', 'wipe', 'demo_data', 'history_import', 'history_remove'].includes(e.op) ? t(`data.journal.status.${e.op}`) : e.op
          const color = operationColor(e.op)
          return <Disclosure key={e.id} className="journal-entry" titleAs="span" title={<>
            <time className="journal-time" dateTime={e.ts} title={fmtDayTime(e.ts)}>{Number.isNaN(date.getTime()) ? e.ts : timeFormat.format(date)}</time>
            <span className="journal-description">{summary(e)}</span>
            <span className="journal-context"><Chip color={color}>{operation}</Chip><span className="journal-actor">{journalActor(e)}</span></span>
          </>}>
            {canEdit && isRevertible(e, canManage) && !reverted.has(e.id) && <div className="journal-undo">
              <p><strong>{t('data.journal.undoNotice')}</strong>{journalUndoEffect(e, hidden)}</p>
              <button className="btn btn--quiet" disabled={busy !== null} onClick={() => revert(e)}>{t('data.journal.revert')}</button>
            </div>}
            <Disclosure variant="inline" className="journal-details" title={t('data.journal.human.details')}>
              <div className="journal-payload"><p>{journalLine(e, hidden)}</p><pre>{journalDetails(e, hidden)}</pre></div>
            </Disclosure>
          </Disclosure>
        })}
      </section>)}
    </div>
  )
}
