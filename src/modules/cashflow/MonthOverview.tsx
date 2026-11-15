import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { fmtMonth, fmtPct } from '../../lib/formatters'
import { type MonthCoverage } from './monthCoverage'
import '../../styles/month-coverage.css'

const P = 'modules.cashflow.flows.coverage'
const placeholderStatus = (month: string, current: string) => month > current ? 'future' : 'outsideHistory'
const shortStatus = (status: string) => status === 'unallocated' ? 'partial' : status === 'allocated' ? 'complete' : status

/** One year of coverage and one controlled month: navigation never changes financial records. */
export function MonthOverview({ items, selected, onSelect, share, children }: {
  items: MonthCoverage[]; selected: string; onSelect: (month: string) => void
  /** The share of a closed month's expenses and income the categories split, %, in the base currency; null — none known */
  share?: (month: string) => { expense: number | null; income: number | null }
  children: (item: MonthCoverage) => ReactNode
}) {
  const { t } = useTranslation()
  const id = useId()
  const track = useRef<HTMLDivElement>(null)
  const remembered = useRef(new Map<string, string>())
  const [edges, setEdges] = useState({ start: true, end: true })
  const years = [...new Set(items.map(item => item.month.slice(0, 4)))].sort()
  const active = items.find(item => item.month === selected) ?? items[0]
  const year = active?.month.slice(0, 4)
  const months = items.filter(item => item.month.startsWith(year ?? '')).sort((a, b) => a.month.localeCompare(b.month))
  const yearKey = years.join(',')

  useEffect(() => {
    const el = track.current
    if (!el) return
    const measure = () => setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 })
    measure()
    el.addEventListener('scroll', measure)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    observer?.observe(el)
    return () => { el.removeEventListener('scroll', measure); observer?.disconnect() }
  }, [yearKey])

  useEffect(() => {
    const el = track.current
    const button = el?.querySelector<HTMLElement>('[aria-pressed=true]')
    if (el && button) {
      const left = button.offsetLeft
      if (left < el.scrollLeft) el.scrollLeft = left
      else if (left + button.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = left + button.offsetWidth - el.clientWidth
    }
  }, [year])

  function chooseYear(nextYear: string) {
    if (active && year) remembered.current.set(year, active.month)
    const candidates = items.filter(item => item.month.startsWith(nextYear)).sort((a, b) => b.month.localeCompare(a.month))
    const next = candidates.find(item => item.month === remembered.current.get(nextYear)) ?? candidates.find(item => item.selectable) ?? candidates[0]
    if (next) onSelect(next.month)
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const index = buttons.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))
    buttons[next]?.focus({ preventScroll: true })
    buttons[next]?.click()
  }

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return <div className="month-ledger">
    {year && <>
      <div className="month-ledger__navigation">
        {(!edges.start || !edges.end) && <button type="button" className="month-ledger__arrow" aria-label={t(`${P}.earlierYears`)} disabled={edges.start} onClick={() => track.current?.scrollBy({ left: -240 })}>‹</button>}
        <div className="pills pills--scroll month-ledger__years" ref={track} role="group" aria-label={t(`${P}.years`)} onKeyDown={keyboard}>
          {years.map(value => <button type="button" key={value} aria-pressed={value === year} aria-controls={`${id}-months`} onClick={() => chooseYear(value)}>{value}</button>)}
        </div>
        {(!edges.start || !edges.end) && <button type="button" className="month-ledger__arrow" aria-label={t(`${P}.laterYears`)} disabled={edges.end} onClick={() => track.current?.scrollBy({ left: 240 })}>›</button>}
      </div>
      <div className="month-ledger__months" id={`${id}-months`} role="group" aria-label={year} onKeyDown={keyboard}>
        {Array.from({ length: 12 }, (_, index) => {
          const ym = `${year}-${String(index + 1).padStart(2, '0')}`
          const item = months.find(value => value.month === ym)
          const status = item?.status ?? placeholderStatus(ym, currentMonth)
          // a closed month shows how much of its expenses the categories split, as progress; a month with income lines only says so
          const part = item && status !== 'notClosed' ? share?.(ym) : undefined
          const text = part?.expense != null ? t(`${P}.expensesPct`, { pct: fmtPct(part.expense) }) : part?.income != null ? t(`${P}.incomeOnly`) : t(`${P}.${shortStatus(status)}`)
          return <button type="button" className="month-ledger__entry" data-status={status} key={ym}
            disabled={!item} aria-label={`${fmtMonth(ym)}: ${part?.expense != null || part?.income != null ? text : t(`${P}.${status}`)}`} aria-pressed={ym === active?.month} aria-controls={id}
            onClick={() => onSelect(ym)}>
            <span className="month-ledger__month month-ledger__month--full">{t(`dates.month.${index + 1}`)}</span>
            <span className="month-ledger__month month-ledger__month--short" aria-hidden="true">{t(`dates.monthShort.${index + 1}`)}</span>
            <span className="month-ledger__status">{text}</span>
            {part?.expense != null && <span className="month-ledger__bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, part.expense))}%` }} /></span>}
          </button>
        })}
      </div>
    </>}
    {active && <div className="month-ledger__body" id={id}>
      <h3 aria-live="polite">{fmtMonth(active.month)}</h3>
      {children(active)}
    </div>}
  </div>
}
