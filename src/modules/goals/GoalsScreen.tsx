import { Field } from '../../pages/admin/ui/Field'
import { ProgressTrack } from '../../components/ui/ProgressTrack'
import { AdminReadNotice } from '../../pages/admin/ui/AdminReadNotice'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { IconArrowDown, IconArrowUp, IconArrowsSort } from '@tabler/icons-react'
import type { Row } from '../../domain/api'
import { useMedia } from '../../lib/media'
import { fmtNum, fmtMonth, fmtPct, fmtCurrencyCents } from '../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { useAdminRows } from '../../pages/admin/useAdminRows'
import { tableQuery, useAdminWrite } from '../../pages/admin/adminQuery'
import { ApiError, apiSend } from '../../lib/api'
import { useToast } from '../../lib/notifyState'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { amountText, amountsInvalid } from '../../pages/admin/amount'
import { hasUnreadDate, UNREAD_DATE } from '../../pages/admin/dateMask'
import { useSingleFlight } from '../../pages/admin/useSingleFlight'
import { Select } from '../../pages/admin/ui/Select'
import { withCurrent, useReferenceLists } from '../../pages/admin/shared'
import { useFamilySettings } from '../../lib/familySettings'
import { isFireGoal } from '../../domain/goals'
import { goalKey } from './goalKey'
import { rowOf } from '../../pages/goals/goalRows'
import { GoalInput, type GoalFields } from '../../pages/goals/GoalForm'
import { LoadingScreen } from '../../pages/admin/ui/LoadingScreen'
import { useCan } from '../../lib/rights'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import { PageAction } from '../../pages/admin/ui/PageAction'
import { RowMenu } from '../../pages/admin/ui/RowMenu'
import { Switch } from '../../components/ui/Switch'
import { onEscape } from '../../pages/admin/ui/onEscape'

const LABEL_KEYS: Record<string, string> = {
  name: 'data.field.name', target: 'modules.goals.field.target', current: 'modules.goals.field.current',
  target_date: 'modules.goals.field.target_date', currency: 'common.currency',
}
const numeric = ['target', 'current']
const months = ['target_date']
const hidden = ['id', 'emoji']
const isFireRow = (r: Row) => isFireGoal({ id: String(r.id ?? ''), name: String(r.name ?? '') })

/** Empty values remain unknown; amounts use the common number formatter. */
function fmtCell(raw: string | number | null, numeric: boolean): string {
  if (raw === null || raw === undefined || raw === '') return '—'
  if (numeric && !isNaN(Number(raw))) return fmtNum(Number(raw), 2)
  return String(raw)
}

/** Inputs whose Enter is not a save: a checkbox or a radio is a choice, not a typed field */
const CHOICE_INPUTS = ['checkbox', 'radio']

/**
 * Enter in a field of an add or edit row saves it, Escape cancels. A <form> cannot wrap a <tr>, so the row handles the keys:
 * a key on a button (Cancel, the calendar, a chip) or on a checkbox keeps its own meaning, and a field may hold Enter
 * itself (a date that cannot be read).
 */
function rowKey(e: KeyboardEvent, save: () => void, cancel: () => void) {
  const typed = e.target instanceof HTMLInputElement && !CHOICE_INPUTS.includes(e.target.type)
  if (e.key === 'Enter' && typed && !e.defaultPrevented && !e.nativeEvent.isComposing) { e.preventDefault(); save() }
  else onEscape(cancel)(e)
}

function goalFields(data: Record<string, unknown>): GoalFields {
  return Object.fromEntries(['name', 'target', 'current', 'target_date', 'currency', 'fire'].map(k => [k, numeric.includes(k) ? amountText(data[k] as string | number | null) : String(data[k] ?? '')])) as GoalFields
}

/** Goal records, including optimistic writes and stale-row protection. */
export function GoalsScreen() {
  const { t } = useTranslation()
  const table = 'goals'
  const settings = useFamilySettings()
  const { currencies, queries: references } = useReferenceLists()
  const queries = [...references, settings]
  const labels = Object.fromEntries(Object.entries(LABEL_KEYS).map(([col, key]) => [col, t(key)]))
  const addLabel = t('modules.goals.add'), emptyLabel = t('modules.goals.empty')
  const fireAvailable = (rows: readonly Row[]) => !rows.some(isFireRow)
  const compact = useMedia('(max-width: 1000px)')
  const canEdit = useCan('edit')
  const tableRef = useRef<HTMLDivElement>(null)
  const [fieldIssue, setFieldIssue] = useState<{ col: string; message: string; scope: 'new' | number } | null>(null)
  const { hidden: privacy } = usePrivacy()
  const label = (col: string) => labels[col] ?? col
  const isNumeric = (col: string) => numeric.includes(col)
  const cellClass = (col: string, display: string) => [
    isNumeric(col) ? 'td-num' : '',
    display === '—' ? 'td-muted' : '',
  ].filter(Boolean).join(' ')
  /** A cell's control in the add or edit row, named by aria-label: the column header is its visible label */
  const editor = (col: string, value: string, onChange: (value: string) => void, autoFocus = false, scope: 'new' | number = 'new') => {
    const issue = fieldIssue?.scope === scope && fieldIssue.col === col ? fieldIssue : null
    const change = (v: string) => { if (issue) setFieldIssue(null); onChange(v) }
    if (col === 'currency') {
      return (
        <Select aria-label={label(col)} value={value} onChange={e => onChange(e.target.value)} autoFocus={autoFocus}>
          {withCurrent(value, currencies).map(v => <option key={v} value={v}>{v}</option>)}
        </Select>
      )
    }
    return <GoalInput field={col as 'name' | 'target' | 'current' | 'target_date'} label={label(col)} value={value} onChange={change} autoFocus={autoFocus} invalid={!!issue} />
  }
  const { rows, setRows, columns: allColumns, loaded, query } = useAdminRows(table)
  const columns = useMemo(() => allColumns.filter(col => !hidden.includes(col)), [allColumns])
  const write = useAdminWrite([tableQuery(table).queryKey])
  const queryClient = useQueryClient()
  const toast = useToast()
  const [deepLinkHandled, setDeepLinkHandled] = useState(false)
  const [editingRowid, setEditingRowid] = useState<number | null>(null)
  const [editData, setEditData]         = useState<Row>({} as Row)
  const [addingRow, setAddingRow]       = useState(false)
  const [newRowData, setNewRowData]     = useState<Record<string, string>>({})
  const [newFlag, setNewFlag]           = useState(false)
  const [editFlag, setEditFlag]         = useState(false)
  const [sortCol, setSortCol]           = useState<string | null>(null)
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>('asc')
  /** The row as it was when its editor opened: the save names it, so a change made meanwhile elsewhere is refused (409 row_changed) */
  const [opened, setOpened] = useState<Row | null>(null)
  const editChanged = editingRowid !== null && opened !== null
    && (Object.keys(editData).some(k => String(editData[k] ?? '') !== String(opened[k] ?? '')) || (editFlag !== isFireRow(opened)))
  useUnsavedChanges(editChanged || (addingRow && Object.values(newRowData).some(v => String(v).trim() !== '')))
  /** A row write is under way: a second Enter (a held key repeats) or click must not send it again */
  const [once] = useSingleFlight()
  /** Start in the family currency when it is available. */
  const newRow: Record<string, string> = { currency: currencies.includes(settings.data?.currency ?? '') ? settings.data!.currency : currencies[0] ?? '', ...newRowData }

  const sortedRows = useMemo(() => {
    if (!sortCol) return rows
    return [...rows].sort((a, b) => {
      const cmp = String(a[sortCol] ?? '').localeCompare(String(b[sortCol] ?? ''), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortCol, sortDir])

  function handleSort(col: string) {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortCol(null); setSortDir('asc') }
    } else {
      setSortCol(col); setSortDir('asc')
    }
  }

  const editorRow = (scope: 'new' | number) => tableRef.current?.querySelector<HTMLElement>(`[data-editor="${scope}"]`)
  const flagField = (scope: 'new' | number, col: string, message: string) => {
    setFieldIssue({ col, message, scope })
    editorRow(scope)?.querySelector<HTMLElement>(`[data-field="${col}"] input, [data-field="${col}"] select`)?.focus()
  }

  const cancelNew = () => { setAddingRow(false); setFieldIssue(issue => issue?.scope === 'new' ? null : issue) }
  const cancelEdit = () => { setEditingRowid(null); setFieldIssue(issue => issue?.scope === editingRowid ? null : issue) }

  /** False, with the notification, when a numeric column or a date of the form cannot be read: such a row is not written */
  function readable(data: Record<string, unknown>, scope: 'new' | number): boolean {
    if (amountsInvalid(data, numeric)) toast.error(t('data.common.saveFailed'), t('data.common.notNumber'))
    else if (hasUnreadDate(data)) {
      const col = Object.keys(data).find(k => data[k] === UNREAD_DATE)
      if (col) {
        const input = editorRow(scope)?.querySelector<HTMLInputElement>(`[data-field="${col}"] input`)
        input?.focus(); input?.blur(); input?.focus()
      }
      return false
    }
    else return true
    return false
  }

  function validated(data: Record<string, unknown>, id: string, scope: 'new' | number) {
    const result = rowOf(goalFields(data), id)
    if (result.row) return result.row
    const col = result.error === 'goalsPage.form.needName' ? 'name' : result.error === 'goalsPage.form.needMonth' ? 'target_date' : 'target'
    flagField(scope, col, t(result.error))
    return null
  }

  // one row write at a time: a save asked for while one is under way is dropped
  const saveEdit = () => once(async () => {
    if (queries.some(q => q.data === undefined)) return
    if (editingRowid === null) return
    if (!readable(editData, editingRowid)) return
    const rowid = editingRowid
    const prev = rows.find(r => r.rowid === rowid)!
    const others = rows.filter(r => r.rowid !== rowid)
    const id = editFlag !== isFireRow(prev) ? goalKey(goalFields(editData), others, editFlag) : String(prev.id)
    const draft = validated(editData, id, editingRowid)
    if (!draft) return
    const edited = { ...editData, ...draft, emoji: editData.emoji ?? null }
    const fields = Object.fromEntries(Object.entries(edited).filter(([key]) => key !== 'rowid'))
    setRows(rs => rs.map(r => r.rowid === rowid ? edited : r))
    setEditingRowid(null); setFieldIssue(issue => issue?.scope === editingRowid ? null : issue)
    const expectedIdentity = Object.fromEntries(Object.entries(opened ?? prev).filter(([key]) => key !== 'rowid'))
    let changedElsewhere = false
    const saved = await write(() => apiSend(`/api/admin/${table}/${rowid}`, 'PUT', { ...fields, expectedIdentity }), t('data.table.rowSaved'), t('data.common.saveFailed'),
      e => { changedElsewhere = e instanceof ApiError && e.code === 'row_changed'; return false })
    if (saved) return
    // a failure opens the editor again with what was typed; after «changed elsewhere» (said, and the rows read again) the next save starts from the row as it is now
    if (changedElsewhere) setOpened(queryClient.getQueryData(tableQuery(table).queryKey)?.rows.find(r => r.rowid === rowid) ?? null)
    // the optimistic row goes back to the stored one unless a read already replaced it
    setRows(rs => rs.map(r => r === edited ? prev : r))
    setEditingRowid(rowid)
  })

  const saveNewRow = () => once(async () => {
    if (queries.some(q => q.data === undefined)) return
    if (!readable(newRow, 'new')) return
    const submitted = validated(newRow, goalKey(newRow, rows, newFlag && fireAvailable(rows)), 'new')
    if (!submitted) return
    const tempRowid = -Date.now()
    setRows(rs => [{ ...submitted, rowid: tempRowid }, ...rs])
    setAddingRow(false); setFieldIssue(issue => issue?.scope === 'new' ? null : issue)
    // on success the refetch puts the server's row in place of the temporary one
    const saved = await write(() => apiSend(`/api/admin/${table}`, 'POST', submitted), t('data.table.rowAdded'), t('data.common.saveFailed'))
    // the typed values are dropped only once the row is stored; a failure opens the form again with them
    if (saved) { setNewRowData({}); setNewFlag(false) }
    else { setRows(rs => rs.filter(r => r.rowid !== tempRowid)); setAddingRow(true) }
  })

  async function deleteRow(rowid: number) {
    const prev = [...rows]
    let optimistic: typeof rows | null = null
    setRows(rs => (optimistic = rs.filter(r => r.rowid !== rowid)))
    // a row already gone (404) stays gone: the read after the failure replaced the rows
    if (!(await write(() => apiSend(`/api/admin/${table}/${rowid}`, 'DELETE'), t('data.table.rowDeleted'), t('data.common.deleteFailed')))) setRows(rs => (rs === optimistic ? prev : rs))
  }

  // Consume the destination only after data and choices arrive; later refetches never reset a draft.
  if (!deepLinkHandled && loaded && allColumns.length > 0 && !queries.some(q => q.data === undefined)) {
    setDeepLinkHandled(true)
    if (canEdit) {
      const params = new URLSearchParams(window.location.search)
      const requested = params.get('edit')
      const row = rows.find(r => String(r['id']) === requested)
      if (requested && row) {
        setOpened(row)
        setEditingRowid(row.rowid)
        setEditData({ ...row })
        setEditFlag(isFireRow(row))
      } else if (params.get('create') === '1') setAddingRow(true)
    }
  }
  if (query.data === undefined) return <><AdminReadNotice queries={[query, ...queries]} />{!loaded && <LoadingScreen action={addLabel} />}</>

  const help = <p className="note">{t('data.goals.currentNote')}</p>
  const renderEditor = (scope: 'new' | number) => {
    const isNew = scope === 'new'
    const data = isNew ? newRow : editData
    const cancel = isNew ? cancelNew : cancelEdit
    const save = isNew ? saveNewRow : saveEdit
    const original = rows.find(row => row.rowid === scope)
    const showFlag = isNew ? fireAvailable(rows) : original && (isFireRow(original) || fireAvailable(rows))
    return <section className="goal-edit-sheet" data-editor={scope} aria-label={t(isNew ? 'data.goals.newTitle' : 'data.goals.editTitle')}
      onKeyDown={e => rowKey(e, () => void save(), cancel)}>
      <div className="goal-edit-intro"><h2>{t(isNew ? 'data.goals.newTitle' : 'data.goals.editTitle')}</h2>{help}</div>
      <div className="goal-edit-form">
        {columns.map((col, i) => <div className="goal-edit-field" data-field={col} key={col}>
          <Field label={label(col)} group={months.includes(col)} variant="comfortable" error={fieldIssue?.scope === scope && fieldIssue.col === col ? fieldIssue.message : undefined}>
          {editor(col, isNumeric(col) && typeof data[col] === 'number' ? amountText(data[col]) : String(data[col] ?? ''),
            value => isNew ? setNewRowData(d => ({ ...d, [col]: value })) : setEditData(d => ({ ...d, [col]: value })), i === 0, scope)}
          </Field>
        </div>)}
        <div className="field goal-edit-field goal-edit-actions">
          {showFlag && <label className="switch-field">
            <Switch checked={isNew ? newFlag : editFlag} label={t('modules.goals.isFire')} onChange={isNew ? setNewFlag : setEditFlag} />
            <span>{t('modules.goals.isFire')}</span>
          </label>}
          <div className="form-actions form-actions--row">
            <button type="button" className="btn btn--ghost" onClick={cancel}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--primary" disabled={queries.some(q => q.data === undefined)} onClick={() => void save()}>{t('data.common.save')}</button>
          </div>
        </div>
      </div>
    </section>
  }
  const progress = (row: Row) => {
    const target = Number(row.target), current = Number(row.current)
    if (row.target == null || row.current == null || !Number.isFinite(target) || !Number.isFinite(current) || target <= 0) return null
    const pct = current / target * 100
    const left = Math.max(0, target - current)
    return <>
      <div className="goal-list-progress">
        <ProgressTrack pct={pct} label={t('data.goals.progress')} />
        <span className="goal-list-progress__value">{fmtPct(pct)}</span>
      </div>
      <span className="goal-list-remaining">{left === 0 ? t('data.goals.reached') : t('data.goals.remaining', {
        amount: privacy ? PRIVACY_MASK : fmtCurrencyCents(left, String(row.currency ?? '')),
      })}</span>
    </>
  }

  return (
    <div ref={tableRef} className="goal-records-page">
      <AdminReadNotice queries={[query, ...queries]} />
      <ViewOnlyNote right="edit" />
      {canEdit && <PageAction>
        <button className="btn btn--ghost" onClick={() => { setFieldIssue(null); setAddingRow(true); setNewRowData({}); setNewFlag(false) }} disabled={allColumns.length === 0 || queries.some(q => q.data === undefined)}>{addLabel}</button>
      </PageAction>}
      {!addingRow && editingRowid === null && help}
      {canEdit && addingRow && renderEditor('new')}
      {canEdit && editingRowid !== null && renderEditor(editingRowid)}
      {compact && rows.length > 0 && <div className="goal-sort">
        <label>{t('data.table.sortBy')}<Select value={sortCol ?? ''} onChange={e => { setSortCol(e.target.value || null); setSortDir('asc') }}>
          <option value="">{t('data.table.originalOrder')}</option>
          {columns.map(col => <option key={col} value={col}>{label(col)}</option>)}
        </Select></label>
        <button type="button" className="btn btn--ghost" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} aria-label={t(sortDir === 'asc' ? 'data.table.descending' : 'data.table.ascending')}>
          {sortDir === 'asc' ? <IconArrowUp aria-hidden="true" /> : <IconArrowDown aria-hidden="true" />}
        </button>
      </div>}
      <div className="admin-table-wrap">
        <div className="admin-table-scroll">
          <table className="admin-table goal-records" data-empty={rows.length === 0}>
            <thead className={compact ? 'sr-only' : undefined}><tr>
              {columns.map(col => {
                const sorted = sortCol === col ? sortDir : null
                const Icon = sorted === 'asc' ? IconArrowUp : sorted === 'desc' ? IconArrowDown : IconArrowsSort
                return <th key={col} className={isNumeric(col) ? 'td-num' : undefined} aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}>
                  {compact ? label(col) : <button type="button" className="th-sort" onClick={() => handleSort(col)}>{label(col)}<Icon size={14} stroke={2} aria-hidden="true" /></button>}
                </th>
              })}
              {canEdit && <th className="td-actions" />}
            </tr></thead>
            <tbody>
              {sortedRows.map(row => {
                const base = String(row['name'] ?? row['id'] ?? row.rowid)
                const rowName = rows.filter(r => r['name'] === row['name']).length > 1 ? `${base} (${row['id'] ?? row.rowid})` : base
                const editing = editingRowid === row.rowid
                return <tr key={row.rowid} className={editing ? 'goal-edit-current' : undefined}>
                  {columns.map(col => {
                    const raw = row[col]
                    const display = privacy && isNumeric(col) && raw !== null && raw !== '' && !isNaN(Number(raw)) ? PRIVACY_MASK
                      : months.includes(col) && raw ? fmtMonth(String(raw).slice(0, 7)) : fmtCell(raw, isNumeric(col))
                    return <td key={col} data-field={col} data-label={label(col)} className={cellClass(col, display) || undefined}>
                      {col === 'name' ? <><span>{display}</span>{editing && <span className="goal-edit-status">{t('data.goals.editing')}</span>}{progress(row)}</> : display}
                    </td>
                  })}
                  {canEdit && <td className="td-actions">{!editing && <RowMenu label={rowName} items={[
                    { label: t('data.common.edit'), onSelect: () => { setFieldIssue(null); setOpened(row); setEditingRowid(row.rowid); setEditData({ ...row }); setEditFlag(isFireRow(row)) } },
                    { label: t('data.common.delete'), onSelect: () => deleteRow(row.rowid), danger: true },
                  ]} />}</td>}
                </tr>
              })}
              {rows.length === 0 && !addingRow && <tr><td colSpan={columns.length + (canEdit ? 1 : 0)} className="empty">{emptyLabel}</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && <div className="admin-table__foot">{t('data.table.rows', { count: rows.length })}</div>}
      </div>
    </div>
  )
}
