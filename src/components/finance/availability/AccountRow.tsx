import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountValue } from '../../../domain/types'
import { accountParts, type aggregateAvailability, type AvailabilityAssessment } from '../../../domain/availability'
import { classLabel, fmtInMonth } from '../../../lib/formatters'
import { usePrivacy } from '../../../lib/privacy'
import { Chip } from '../../ui/Chip'
import { OwnerAvatar } from '../../ui/OwnerAvatar'
import type { SemanticColor } from '../../ui/types'

type Status = ReturnType<typeof aggregateAvailability>['accounts'][number]['status']
type Shown = Status | 'unavailable'
const CHIP: Record<Shown, SemanticColor> = { confirmed: 'success', unavailable: 'secondary', negative: 'secondary', unknown: 'warning', stale: 'warning', missingFx: 'warning', invalid: 'warning' }
const EARMARKS = ['reserve', 'goals', 'commitments'] as const
const PARTS = [...EARMARKS, 'free'] as const

interface AccountRowProps {
  account: AccountValue
  assessment?: AvailabilityAssessment
  status: Status
  month: string
  members: string[]
  money: (value: number, currency?: string) => string
  /** Opens or closes the editor; undefined — no action (a viewer, privacy mode, a negative balance) */
  onAction?: () => void
  open: boolean
  /** The editor, under the row while it is open */
  children?: ReactNode
}

/**
 * An account of the month: the owner, name and «owner · type · currency», its own bar of the earmarks and the free rest
 * (hatched when not available at once, empty until confirmed) with the caption, the balance in its currency, the status
 * chip and the action.
 */
export function AccountRow({ account, assessment, status, month, members, money, onAction, open, children }: AccountRowProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const confirmed = status === 'confirmed' || status === 'missingFx'
  // last month's answer is not this month's: the row asks again; a balance changed after this month's answer says so
  const shown: Shown = status === 'confirmed' && !assessment!.available ? 'unavailable' : status === 'stale' && assessment!.month !== month ? 'unknown' : status
  const parts = confirmed ? accountParts(account, assessment) : null
  const unavailable = confirmed && !assessment!.available
  const caption = status === 'negative' ? t('availability.captionNegative')
    : status === 'missingFx' ? t('availability.captionMissingFx')
    : status === 'invalid' ? t('availability.captionInvalid')
    : unavailable ? t('availability.captionUnavailable')
    : parts ? parts.setAside > 0
      ? t('availability.captionSetAside', { free: money(parts.free, account.currency), amount: money(parts.setAside, account.currency), why: EARMARKS.filter(k => parts[k] > 0).map(k => t(`availability.${k}`).toLocaleLowerCase()).join(', ') })
      : t('availability.captionFree', { free: money(parts.free, account.currency) })
    : !assessment ? t('availability.captionNew')
    : assessment.available ? t('availability.captionBefore', { month: fmtInMonth(assessment.month), amount: money(accountParts(account, assessment)!.setAside, assessment.currency) })
    : t('availability.captionBeforeUnavailable', { month: fmtInMonth(assessment.month) })
  return <li className="avail-row" aria-label={account.name}>
    {account.member ? <OwnerAvatar member={account.member} members={members} /> : <span className="lane__avatar" aria-hidden="true" />}
    <div className="avail-row__who">
      <div className="avail-row__name">{account.name}</div>
      <div className="avail-row__meta">{[account.member, classLabel(account.class), account.currency].filter(Boolean).join(' · ')}</div>
    </div>
    <div className="avail-row__bar">
      <div className="avail-mb" aria-hidden="true">
        {!hidden && unavailable && <i className="avail-part--unavailable" style={{ flexGrow: 1 }} />}
        {!hidden && parts && PARTS.filter(k => parts[k] > 0).map(k => <i key={k} data-part={k} className={`avail-part--${k}`} style={{ flexGrow: parts[k] }} />)}
      </div>
      <div className="avail-row__caption">{caption}</div>
    </div>
    <div className="avail-row__bal">
      <span className="num">{money(account.value, account.currency)}</span>
      <Chip color={CHIP[shown]}>{t(`availability.status.${shown}`)}</Chip>
    </div>
    {onAction ? <button type="button" className={`btn ${confirmed ? 'btn--quiet' : 'btn--ghost'} avail-row__act`} aria-expanded={open} onClick={onAction}
      aria-label={t(confirmed ? 'availability.changeName' : 'availability.confirmName', { name: account.name })}>{t(confirmed ? 'availability.change' : 'availability.confirm')}</button>
      : <span className="avail-row__act" />}
    {children}
  </li>
}
