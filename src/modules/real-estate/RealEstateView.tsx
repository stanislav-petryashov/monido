import { AdminReadNotice } from '../../pages/admin/ui/AdminReadNotice'
import '../../pages/admin/journal-mobile.css'
import { IconArrowLeft } from '@tabler/icons-react'
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { PropertyDeleteRequest, PropertyUpdateRequest, Row } from '../../domain/api'
import { monthOf } from '../../domain/dates'
import { equitySteps, latestValuation, securedByMortgage, propertyEquity, propertyGain, propertyShare, valuationChanges, type Valuation } from '../../domain/realEstate'
import { apiSend } from '../../lib/api'
import { PHONE, useMedia } from '../../lib/media'
import { useConfirm, useToast } from '../../lib/notifyState'
import { recordFromHash, recordHref } from '../../lib/recordLink'
import { navigate } from '../../lib/router'
import { useCan } from '../../lib/rights'
import { useSnapshot } from '../../lib/useFinanceData'
import { changed, useDiscardGuard } from '../../lib/useUnsavedChanges'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import { tableQuery, useSnapshotWrite } from '../../pages/admin/adminQuery'
import { amountText, amountsInvalid, parseAmount, readAmounts, readable } from '../../pages/admin/amount'
import { useReferenceLists } from '../../pages/admin/shared'
import { PageAction } from '../../pages/admin/ui/PageAction'
import type { MenuItem } from '../../pages/admin/ui/RowMenu'
import { useRecordPane } from '../../pages/admin/useRecordPane'
import { useSingleFlight } from '../../pages/admin/useSingleFlight'
import { TONES } from '../../pages/assets/tones'
import { EquityWaterfall } from './view/EquityWaterfall'
import { NewPropertyDialog } from './view/NewPropertyDialog'
import { PropertyForm } from './view/PropertyForm'
import { PropertyHead } from './view/PropertyHead'
import { PropertyKpis } from './view/PropertyKpis'
import { PropertyList, type ListProperty } from './view/PropertyList'
import { StaleNotice } from './view/StaleNotice'
import { ValuationEditor, ValuationsTable, type TableValuation } from './view/ValuationsTable'
import { ValueStepChart } from './view/ValueStepChart'

interface PropertyInfo {
  name: string
  purchase_date: string
  purchase_price: number | string
  purchase_currency: string
  /** The owner; '' — none */
  member: string
}

interface ValuationRow {
  rowid: number
  valuation_year: number | string
  value: number | string
  currency: string
  notes: string | null
}

interface RealEstateViewProps {
  rows: Row[]
  /** An optimistic edit of the cached rows */
  setRows: Dispatch<SetStateAction<Row[]>>
}

type Fields = Record<string, string>

/** Every write refetches the table; the snapshot follows (the list's share, the KPIs, equity) */
const WRITES = [tableQuery('real_estate').queryKey]

/** The amount fields of a property row: AmountInput in the forms, read by parseAmount before they are written */
const AMOUNTS = ['purchase_price', 'value']

/** The property form with its owner: none picked ('') is saved as no owner (NULL). */
const withOwner = (data: Fields) => ({ ...data, member: data['member'] || null })

const toValuation = (v: ValuationRow): Valuation => ({ year: Number(v.valuation_year), value: Number(v.value), currency: v.currency })

/**
 * The Real estate screen: the list of properties beside the chosen one — its head with «Enter the <year> valuation» and
 * the «···» menu, the missing-valuation notice, the KPIs and, with a linked loan, the equity row; the value by year, the
 * equity waterfall, the valuations with their editor in place. On a phone (useRecordPane) the list and the property are
 * two screens. The figures are the domain's (realEstate.ts) over the rows and the snapshot's capital.
 */
export function RealEstateView({ rows, setRows }: RealEstateViewProps) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()
  const canEdit = useCan('edit')
  const pane = useRecordPane()
  const phone = useMedia(PHONE)
  const write = useSnapshotWrite(WRITES)
  const snapshot = useSnapshot().data
  const capital = snapshot?.capital ?? null
  const { currencies, members, queries: listQueries, ready: referencesReady } = useReferenceLists()
  /** The family in its order (the owners' tints); the sorted list until the snapshot comes */
  const familyOrder = snapshot?.members ?? members
  /** The last closed month and its year: the chart runs to it, the notice and «Enter the <year> valuation» read it */
  const month = capital ? monthOf(capital.date) : null
  const assetsKnown = !!month && snapshot?.capitalCoverage?.find(c => c.month === month)?.assetsKnown === true
  const currentYear = month ? Number(month.slice(0, 4)) : new Date().getUTCFullYear()
  // the rows are loaded before this view mounts: a property the address names (/real-estate#<name>, from Net worth) opens selected,
  // an unknown name opens none, no name opens the largest — as Accounts and Loans do
  const [selectedName, setSelectedName] = useState<string | null>(() => {
    const linked = recordFromHash()
    if (linked === null) return null
    return rows.some(r => String(r.name) === linked) ? linked : ''
  })
  const [addingProperty, setAddingProperty]     = useState(false)
  const [newProperty, setNewProperty]           = useState<Fields>({})
  const [addingValuation, setAddingValuation]   = useState(false)
  const [newValuation, setNewValuation]         = useState<Fields>({})
  const [editingRowid, setEditingRowid]         = useState<number | null>(null)
  const [editData, setEditData]                 = useState<Fields>({})
  const [editingProperty, setEditingProperty]   = useState(false)
  const [editPropertyData, setEditPropertyData] = useState<Fields>({})
  const [propertyTarget, setPropertyTarget] = useState<PropertyInfo | null>(null)
  const [valuationTarget, setValuationTarget] = useState<ValuationRow | null>(null)
  const [runSave, saving, savePending] = useSingleFlight()
  const [runNew, creating, newPending] = useSingleFlight()
  const [propertyBaseline, setPropertyBaseline] = useState<Fields>({})
  const [valuationBaseline, setValuationBaseline] = useState<Fields>({})
  const [newPropertyBaseline, setNewPropertyBaseline] = useState<Fields>({})
  const [newValuationBaseline, setNewValuationBaseline] = useState<Fields>({})
  const formRisk = saving || creating || (addingProperty && changed(newProperty, newPropertyBaseline)) || (addingValuation && changed(newValuation, newValuationBaseline)) || (editingProperty && changed(editPropertyData, propertyBaseline)) || (editingRowid !== null && changed(editData, valuationBaseline))
  const { discard, confirmDiscard } = useDiscardGuard(formRisk, savePending, newPending)
  function cancelEditors() { setEditingProperty(false); setAddingValuation(false); setEditingRowid(null); setPropertyTarget(null); setValuationTarget(null) }

  /** A property's rows: one per valuation */
  const rowsOf = (name: string) => rows.filter(r => String(r.name) === name)

  function getPropertyInfo(name: string): PropertyInfo | undefined {
    const r = rowsOf(name)[0]
    if (!r) return undefined
    return {
      name,
      purchase_date:     String(r.purchase_date ?? ''),
      purchase_price:    r.purchase_price as number,
      purchase_currency: String(r.purchase_currency ?? ''),
      member:            String(r.member ?? ''),
    }
  }

  function getValuations(name: string): ValuationRow[] {
    return rowsOf(name)
      .map(r => ({ rowid: r.rowid, valuation_year: r.valuation_year as number, value: r.value as number, currency: String(r.currency ?? ''), notes: r.notes as string | null }))
      .sort((a, b) => Number(b.valuation_year) - Number(a.valuation_year))
  }

  /** The list: each property with its latest valuation, its change, its base value and tone, its equity; largest first */
  const listed = useMemo((): ListProperty[] => {
    const names = [...new Set(rows.map(r => String(r.name)))]
    const items = names.map((name): ListProperty => {
      const valuations = rows.filter(r => String(r.name) === name).map(r => ({ year: Number(r.valuation_year), value: Number(r.value), currency: String(r.currency ?? '') }))
      const first = rows.find(r => String(r.name) === name)!
      const latest = latestValuation(valuations)
      const change = valuationChanges(valuations, { price: Number(first.purchase_price), currency: String(first.purchase_currency ?? '') })[0]
      const held = capital?.realEstate.find(r => r.name === name)
      return {
        name, member: String(first.member ?? ''), currency: latest?.currency ?? String(first.purchase_currency ?? ''),
        value: latest?.value, year: latest?.year ?? null, change: change?.change ?? null,
        valueBase: held?.valueBase ?? null, missing: !capital || !held ? 'snapshot' : held.valueBase === null || !Number.isFinite(held.valueBase) ? 'conversion' : null, tone: TONES.real_estate[0],
        equity: capital ? propertyEquity(capital, name) : null,
      }
    })
    items.sort((a, b) => (b.valueBase ?? -1) - (a.valueBase ?? -1))
    items.forEach((p, rank) => { p.tone = TONES.real_estate[Math.min(rank, TONES.real_estate.length - 1)] })
    return items
  }, [rows, capital])
  /** The chosen property: the one picked or linked; an unknown link ('') — none; none chosen — the largest */
  const shownName = selectedName === null ? listed[0]?.name ?? null : selectedName || null

  /** False, with the notification, when an amount or a date of the form cannot be read: such a form is not saved */
  const readableForm = (data: Fields) => readable(data, amountsInvalid(data, AMOUNTS), toast, t)
  /** The purchase currency a form shows: the chosen one, else the family's first */
  const purchaseCurrency = (d: Fields) => d['purchase_currency'] || currencies[0] || ''

  async function addProperty(): Promise<boolean> {
    if (!referencesReady) return false
    const draft = { ...newProperty }
    if (purchaseCurrency(draft)) draft['purchase_currency'] = purchaseCurrency(draft)
    // the first valuation is in the purchase currency
    if (draft['purchase_currency']) draft['currency'] = draft['purchase_currency']
    if (!readableForm(draft)) return false
    const saved = await write(() => apiSend('/api/admin/real_estate', 'POST', withOwner(readAmounts(draft, AMOUNTS))), [t('modules.real_estate.added'), newProperty['name'] || undefined], t('data.common.saveFailed'))
    if (!saved) return false
    setAddingProperty(false)
    setSelectedName(draft['name'] ?? null)
    pane.open()
    setNewProperty({})
    return true
  }

  async function updatePropertyInfo() {
    if (!referencesReady) return
    if (!shownName) return
    const opened = propertyTarget ?? getPropertyInfo(shownName)
    if (!opened) return
    const capturedName = opened.name
    const newName = editPropertyData['name'] ?? capturedName
    if (!readableForm(editPropertyData)) return
    const draft = { ...editPropertyData }
    if (purchaseCurrency(draft)) draft['purchase_currency'] = purchaseCurrency(draft)
    const price = parseAmount(draft['purchase_price'] ?? '').value
    if (price === null) { toast.error(t('data.common.saveFailed'), t('data.common.notNumber')); return }
    const body: PropertyUpdateRequest = {
      name: capturedName,
      values: { name: newName, purchase_date: draft['purchase_date'] ?? '', purchase_price: price, purchase_currency: draft['purchase_currency'] ?? '', member: draft['member'] || null },
      expected: { purchase_date: opened.purchase_date, purchase_price: opened.purchase_price, purchase_currency: opened.purchase_currency, member: opened.member || null },
    }
    const saved = await write(() => apiSend('/api/real-estate/update', 'POST', body), [t('modules.real_estate.saved'), newName], t('data.common.saveFailed'))
    if (!saved) return
    if (shownName === capturedName) {
      setEditingProperty(false)
      setPropertyTarget(null)
      setSelectedName(newName)
    }
  }

  async function addValuation() {
    if (!referencesReady) return
    if (!shownName) return
    const info = propertyTarget ?? getPropertyInfo(shownName)
    if (!info) return
    const draft = { ...newValuation }
    if (!readableForm(draft)) return
    const saved = await write(() => apiSend('/api/admin/real_estate', 'POST', {
      name:              shownName,
      purchase_date:     info.purchase_date,
      purchase_price:    info.purchase_price,
      purchase_currency: info.purchase_currency,
      member:            info.member || null,
      ...readAmounts(draft, AMOUNTS),
    }), [t('modules.real_estate.valuationAdded'), shownName], t('data.common.saveFailed'))
    if (!saved) return
    setAddingValuation(false)
    setPropertyTarget(null)
    setNewValuation({})
  }

  async function saveEditValuation() {
    if (!referencesReady) return
    const v = valuationTarget
    if (!v || !readableForm(editData)) return
    const data = readAmounts(editData, AMOUNTS)
    if (await write(() => apiSend(`/api/admin/real_estate/${v.rowid}`, 'PUT', { ...data, expectedIdentity: { name: shownName, valuation_year: v.valuation_year } }), t('modules.real_estate.valuationSaved'), t('data.common.saveFailed'))) cancelEditors()
  }

  async function deleteValuation(rowid: number) {
    // the only valuation is the property itself: deleting it deletes the property, so it asks like one
    if (shownName && rowsOf(shownName).length <= 1) return deleteProperty()
    const prevRows = [...rows]
    let optimistic: typeof rows | null = null
    setRows(rs => (optimistic = rs.filter(r => r.rowid !== rowid)))
    // a valuation already gone (404) stays gone: the read after the failure replaced the rows
    if (!(await write(() => apiSend(`/api/admin/real_estate/${rowid}`, 'DELETE'), t('modules.real_estate.valuationDeleted'), t('data.common.deleteFailed')))) setRows(rs => (rs === optimistic ? prevRows : rs))
  }

  async function deleteProperty() {
    if (!shownName) return
    if (!(await confirm({ title: t('modules.real_estate.deleteTitle', { name: shownName }), text: t('modules.real_estate.deleteText'), confirmLabel: t('data.common.delete'), tone: 'danger' }))) return
    const name = shownName
    const body: PropertyDeleteRequest = { name }
    const done = await write(() => apiSend('/api/real-estate/delete', 'POST', body), [t('modules.real_estate.deleted'), name], t('data.common.deleteFailed'))
    if (!done) return
    setSelectedName(null)
    pane.back()
  }

  const propInfo = propertyTarget ?? (shownName ? getPropertyInfo(shownName) ?? null : null)
  const vals = shownName ? getValuations(shownName) : []
  if (valuationTarget && !vals.some(v => v.rowid === valuationTarget.rowid)) vals.push(valuationTarget)
  const valuations = vals.map(toValuation)
  const latest = latestValuation(valuations)
  const purchase = propInfo ? { price: Number(propInfo.purchase_price), date: propInfo.purchase_date, currency: propInfo.purchase_currency } : null
  const gain = purchase ? propertyGain(purchase, valuations) : null
  const tableRows: TableValuation[] = purchase ? valuationChanges(vals.map(v => ({ ...toValuation(v), rowid: v.rowid, notes: v.notes })), purchase) : []
  const held = shownName ? capital?.realEstate.find(r => r.name === shownName) : undefined
  const equity = shownName && capital ? propertyEquity(capital, shownName) : null
  const steps = equity && purchase && held ? equitySteps(purchase, { value: held.value, currency: held.currency }, equity.loans) : null
  /** The year a new valuation is for: the closed month's, or the next after a valuation of it or later */
  const enterYear = latest && latest.year >= currentYear ? latest.year + 1 : currentYear
  const stale = latest !== null && month !== null && latest.year < currentYear
  const editorOpen = addingValuation || editingProperty || editingRowid !== null

  function startNewValuation() {
    if (!propInfo) return
    void discard(() => {
      cancelEditors()
      setPropertyTarget(propInfo)
      const data = { valuation_year: String(enterYear), currency: latest?.currency || propInfo.purchase_currency || currencies[0] || '' }
      setNewValuationBaseline(data)
      setNewValuation(data)
      setAddingValuation(true)
    })
  }

  function startEditProperty() {
    if (!propInfo) return
    void discard(() => {
      cancelEditors()
      setPropertyTarget(propInfo)
      setEditingProperty(true)
      const data = { name: propInfo.name, purchase_date: propInfo.purchase_date, purchase_price: amountText(propInfo.purchase_price), purchase_currency: propInfo.purchase_currency, member: propInfo.member }
      setPropertyBaseline(data)
      setEditPropertyData(data)
    })
  }

  function startEditValuation(v: TableValuation) {
    const row = vals.find(r => r.rowid === v.rowid)
    if (!row || !propInfo) return
    void discard(() => {
      cancelEditors()
      setPropertyTarget(propInfo)
      setValuationTarget(row)
      setEditingRowid(row.rowid)
      const data = { valuation_year: String(row.valuation_year), value: amountText(row.value), currency: row.currency, notes: row.notes ?? '' }
      setValuationBaseline(data)
      setEditData(data)
    })
  }

  const menu: MenuItem[] = canEdit && propInfo ? [
    { label: t('modules.real_estate.menuEdit'), onSelect: startEditProperty },
    equity
      ? { label: t('modules.real_estate.menuLoan', { name: equity.loans[0].name }), onSelect: () => navigate(recordHref('/loans', equity.loans[0].name)) }
      : { label: t('modules.real_estate.menuLink'), onSelect: () => navigate('/loans') },
    { label: t('modules.real_estate.menuDelete'), danger: true, onSelect: () => void deleteProperty() },
  ] : []

  return (
    <div className={`admin-split re-split${pane.opened && propInfo ? ' admin-split--detail' : ''}`}>
      <AdminReadNotice queries={listQueries} />
      <ViewOnlyNote right="edit" />
      {canEdit && (
        <PageAction>
          <button className="btn btn--ghost" disabled={!referencesReady} onClick={() => void discard(() => {
            cancelEditors()
            const data = { valuation_year: String(currentYear) }
            setNewPropertyBaseline(data)
            setNewProperty(data)
            setAddingProperty(true)
          })}>{t('modules.real_estate.add')}</button>
        </PageAction>
      )}

      {canEdit && addingProperty && (
        <NewPropertyDialog data={newProperty} setData={setNewProperty} currency={purchaseCurrency(newProperty)} currencies={currencies} members={members}
          busy={creating} onSubmit={async () => (await runNew(addProperty)) ?? false} beforeCancel={formRisk ? confirmDiscard : undefined} onCancel={() => setAddingProperty(false)} />
      )}

      <PropertyList
        label={t('modules.real_estate.list')}
        properties={listed}
        members={familyOrder}
        base={capital && snapshot ? { currency: snapshot.baseCurrency, assets: assetsKnown ? capital.assets : null } : null}
        selected={pane.visible ? shownName : null}
        onSelect={name => {
          if (name === shownName) { pane.open(); return }
          void discard(() => { cancelEditors(); setSelectedName(name); pane.open() })
        }}
        empty={t('modules.real_estate.empty')}
      />

      {shownName && propInfo && purchase && pane.visible ? (
        <div className="record-detail">
          <button type="button" className="btn btn--ghost record-detail__back" onClick={() => void discard(() => { cancelEditors(); pane.back() })}><IconArrowLeft size={16} aria-hidden="true" />{t('modules.real_estate.title')}</button>
          <section className="admin-panel">
            {canEdit && editingProperty ? (
              <PropertyForm data={editPropertyData} setData={setEditPropertyData} currency={purchaseCurrency(editPropertyData)} currencies={currencies} members={members}
                count={vals.length} saving={saving} submitDisabled={!referencesReady} onSubmit={() => void runSave(updatePropertyInfo)} onCancel={() => void discard(cancelEditors)} />
            ) : (
              <>
                <PropertyHead name={propInfo.name} member={propInfo.member} members={familyOrder} currency={latest?.currency ?? propInfo.purchase_currency} purchaseDate={propInfo.purchase_date}
                  enter={canEdit ? { label: t('modules.real_estate.enter', { year: enterYear }), quiet: editorOpen || !stale, onClick: startNewValuation } : null}
                  menu={menu} />
                {stale && latest && month && <StaleNotice year={currentYear} month={month} valued={latest.year} />}
                {latest && (
                  <PropertyKpis latest={latest} purchase={purchase} gain={gain}
                    base={capital && snapshot ? { valueBase: held?.valueBase ?? null, share: assetsKnown ? propertyShare(capital, shownName) : null, currency: snapshot.baseCurrency, assets: assetsKnown ? capital.assets : null, date: capital.date } : null}
                    equity={equity} loanHref={equity ? recordHref('/loans', equity.loans[0].name) : null} />
                )}
              </>
            )}
          </section>

          {latest && (
            <section className="admin-panel admin-chart" aria-labelledby="re-chart-title">
              <div className="card-hd--row acc-card__hd">
                <h2 className="card-hd" id="re-chart-title">{t('modules.real_estate.chart.title')}</h2>
                <span className="acc-card__meta">{t('modules.real_estate.chart.meta', { currency: latest.currency })}</span>
              </div>
              <ValueStepChart name={propInfo.name} purchase={purchase} currency={latest.currency} currentYear={currentYear} compact={phone}
                valuations={valuations.filter(v => v.currency === latest.currency)} />
              <div className="chart-key re-key">
                <span><i className="re-key__step" />{t('modules.real_estate.chart.keyStep')}</span>
                {purchase.currency === latest.currency && <span><i className="re-key__buy" />{t('modules.real_estate.chart.keyBuy')}</span>}
                {!valuations.some(v => v.year >= currentYear) && <span><i className="re-key__now" />{t('modules.real_estate.chart.keyNow', { year: currentYear, valued: latest.year })}</span>}
                <span><i className="chart-key__bar re-key__bar" />{t('modules.real_estate.chart.keyBar')}</span>
              </div>
            </section>
          )}

          {steps && month && <EquityWaterfall steps={steps} currency={purchase.currency} month={month} ltv={equity?.ltvPct ?? null} compact={phone} mortgage={!!equity && securedByMortgage(equity.loans)} />}

          <ValuationsTable
            valuations={tableRows}
            currency={latest?.currency ?? purchase.currency}
            actions={canEdit ? { edit: startEditValuation, remove: v => void deleteValuation(v.rowid) } : null}
            adding={canEdit && addingValuation ? (
              <ValuationEditor data={newValuation} setData={setNewValuation} currencies={currencies} saving={saving} submitDisabled={!referencesReady}
                compare={latest ? { ...latest, price: purchase.price, priceCurrency: purchase.currency } : null} placeholder={latest?.value}
                saveLabel={t('modules.real_estate.saveValuation')} onSave={() => void runSave(addValuation)} onCancel={() => void discard(cancelEditors)} />
            ) : null}
            editing={canEdit && editingRowid !== null ? {
              rowid: editingRowid,
              editor: <ValuationEditor data={editData} setData={setEditData} currencies={currencies} saving={saving} submitDisabled={!referencesReady} compare={null}
                saveLabel={t('data.common.save')} onSave={() => void runSave(saveEditValuation)} onCancel={() => void discard(cancelEditors)} />,
            } : null} />
        </div>
      ) : (
        <div className="empty record-empty">{listed.length > 0 ? t('modules.real_estate.pick') : t('modules.real_estate.addFirst')}</div>
      )}
    </div>
  )
}
