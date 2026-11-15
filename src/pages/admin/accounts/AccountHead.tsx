import { useTranslation } from 'react-i18next'
import type { AccountRef } from '../../../domain/accounts'
import { classLabel } from '../../../lib/formatters'
import { OwnerAvatar } from '../../../components/ui/OwnerAvatar'
import { RowMenu, type MenuItem } from '../ui/RowMenu'

interface AccountHeadProps {
  acc: AccountRef
  /** The account's tone class suffix (`tones.ts`): its rank by value within its type */
  tone: string
  members: string[]
  /** «Correct <month>»: the screen's main action; null — none (no rights, or no row in that month) */
  correct: { label: string; onClick: () => void } | null
  /** The «···» menu: settings, close, delete; empty — no menu (a viewer) */
  menu: MenuItem[]
}

/** The account's detail head: the name, the tags — owner, type with its tone, currency — and the actions. */
export function AccountHead({ acc, tone, members, correct, menu }: AccountHeadProps) {
  const { t } = useTranslation()
  return (
    <div className="acc-head">
      <div className="acc-head__text">
        <h2 className="acc-head__name">{acc.bank}</h2>
        <ul className="acc-head__tags" aria-label={t('data.accounts.tags')}>
          {acc.member && <li className="acc-tag"><OwnerAvatar member={acc.member} members={members} />{acc.member}</li>}
          <li className="acc-tag"><i className={`asset-map__swatch asset-tone--${tone}`} aria-hidden="true" />{classLabel(acc.class)}</li>
          <li className="acc-tag">{acc.currency}</li>
        </ul>
      </div>
      {(correct || menu.length > 0) && (
        <div className="acc-head__actions">
          {correct && <button type="button" className="btn btn--ghost" onClick={correct.onClick}>{correct.label}</button>}
          {menu.length > 0 && <RowMenu label={acc.bank} ariaLabel={t('data.accounts.menu')} items={menu} />}
        </div>
      )}
    </div>
  )
}
