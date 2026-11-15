import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentedPills } from '../../components/ui/SegmentedPills'
import { strokeHeight, visibleYears, type YearCell } from '../../domain/yearCells'
import { fmtMonthShort, fmtMonthYear } from '../../lib/formatters'
import { PHONE, useMedia } from '../../lib/media'
import { signed } from '../../lib/pageHelpers'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { navigate } from '../../lib/router'

/** Years across; on a phone one year at a time */
const WINDOW = 4

interface YearsCombProps {
  cells: YearCell[]
  /** The selected month, 'YYYY-MM' */
  selected: string
  onSelect: (month: string) => void
  /** How many years the window is shifted back from the latest */
  offset: number
  onOffset: (n: number) => void
  fmt: (v: number) => string
}

/**
 * The years comb: the net-worth history as calendar-year cells of twelve month strokes, the current year marked "in
 * progress". A closed month is a full-height button whose inner grey bar's height is its net worth over the whole history's range, the
 * selected one in the primary; the open month is a dashed outline that leads to Close month; a month without data is an empty, inert stroke. Earlier/Later shift the four-year window when the
 * history has more years. Below 640px one year shows at a time, picked with pills.
 */
export function YearsComb({ cells, selected, onSelect, offset, onOffset, fmt }: YearsCombProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const phone = useMedia(PHONE)
  const coarse = useMedia('(pointer: coarse)')
  const combRef = useRef<HTMLDivElement>(null)
  const [phoneYear, setPhoneYear] = useState<string | null>(null)

  const visible = visibleYears(cells, WINDOW, offset)
  const values = cells.flatMap(c => c.months.map(m => m.netWorth)).filter((v): v is number => v !== null)
  const range = { min: Math.min(...values), max: Math.max(...values) }

  // the phone's year: the one picked while it is in the window, else the current year, else the latest
  const picked = visible.find(c => String(c.year) === phoneYear) ?? visible.find(c => c.current) ?? visible.at(-1)
  const shown = phone && picked ? [picked] : visible
  const paged = cells.length > WINDOW
  const atStart = visible[0] === cells[0]

  useEffect(() => {
    if (!coarse) return
    for (const track of combRef.current?.querySelectorAll<HTMLElement>('.comb__strokes') ?? []) {
      const button = track.querySelector<HTMLElement>('[aria-pressed=true]') ?? [...track.querySelectorAll<HTMLElement>('[aria-pressed]')].at(-1)
      if (!button) continue
      const left = button.offsetLeft, right = left + button.offsetWidth
      if (left < track.scrollLeft) track.scrollLeft = left
      else if (right > track.scrollLeft + track.clientWidth) track.scrollLeft = right - track.clientWidth
    }
  }, [coarse, selected, phoneYear, offset, cells])

  return (
    <div className="comb-block">
      {phone && picked && (
        <SegmentedPills overflow="scroll" items={visible.map(c => String(c.year))} active={String(picked.year)} onSelect={setPhoneYear} ariaLabel={t('pages.overview.combYears')} />
      )}
      <div className="comb" ref={combRef} role="group" aria-label={t('pages.overview.combLabel')}>
        {shown.map(cell => (
          <div key={cell.year} className={cell.current ? 'comb__year comb__year--current' : 'comb__year'}>
            <div className="comb__head">
              <span className="comb__head-year">
                {cell.year}
                {cell.current && <span className="comb__head-tag">{` · ${t('pages.overview.inProgress')}`}</span>}
              </span>
              <span className="comb__head-value num">{cell.endNetWorth === null ? '—' : fmt(cell.endNetWorth)}</span>
            </div>
            <div className="comb__strokes">
              {cell.months.map(m => {
                const none = m.state === 'none'
                const label = fmtMonthYear(m.month)
                return (
                  <button
                    key={m.month}
                    type="button"
                    className={`comb__stroke${m.state === 'open' ? ' comb__stroke--open' : none ? ' comb__stroke--none' : ''}`}
                    aria-label={m.state === 'open' ? t('pages.overview.openStroke', { month: label }) : label}
                    aria-pressed={m.state === 'closed' ? m.month === selected : undefined}
                    aria-hidden={none || undefined}
                    disabled={none}
                    tabIndex={none ? -1 : undefined}
                    // the open month has no value to select: its stroke leads to the wizard that closes it
                    onClick={m.state === 'closed' ? () => onSelect(m.month) : m.state === 'open' ? () => navigate('/close') : undefined}
                  >
                    {/* the button is the whole column's height, a target to tap; the bar inside is the drawing */}
                    <i className="comb__bar" style={m.netWorth === null ? undefined : { height: `${strokeHeight(m.netWorth, range)}px` }} />
                    <span className="comb__month" aria-hidden="true">{fmtMonthShort(m.month)}</span>
                  </button>
                )
              })}
            </div>
            <div className="comb__foot">
              {cell.change !== null && (
                <span className="comb__change num">
                  {hidden ? PRIVACY_MASK : signed(cell.change, fmt)}
                </span>
              )}
              {cell.change !== null && cell.changeMonths > 0 && ' '}
              {cell.changeMonths > 0 && <span className="comb__over">{t('pages.overview.combOver', { count: cell.changeMonths })}</span>}
            </div>
          </div>
        ))}
      </div>
      {paged && (
        <div className="comb__nav">
          <button type="button" className="btn btn--quiet" disabled={atStart} onClick={() => onOffset(offset + 1)}>{t('pages.overview.earlier')}</button>
          <button type="button" className="btn btn--quiet" disabled={offset <= 0} onClick={() => onOffset(offset - 1)}>{t('pages.overview.later')}</button>
        </div>
      )}
    </div>
  )
}
