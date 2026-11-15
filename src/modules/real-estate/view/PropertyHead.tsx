import { useTranslation } from 'react-i18next'
import { classLabel, fmtDayNumeric } from '../../../lib/formatters'
import { OwnerAvatar } from '../../../components/ui/OwnerAvatar'
import { RowMenu, type MenuItem } from '../../../pages/admin/ui/RowMenu'

interface PropertyHeadProps {
  name: string
  /** The owner; '' — none */
  member: string
  members: string[]
  currency: string
  purchaseDate: string
  /** «Enter the <year> valuation»: the screen's one primary, quiet while an editor is open; null — none (a viewer) */
  enter: { label: string; quiet: boolean; onClick: () => void } | null
  /** The «···» menu; empty — none (a viewer) */
  menu: MenuItem[]
}

/** The property's head: the name, the tags — owner, type with its tone, currency, purchase day — and the actions. */
export function PropertyHead({ name, member, members, currency, purchaseDate, enter, menu }: PropertyHeadProps) {
  const { t } = useTranslation()
  return (
    <div className="acc-head re-head">
      <div className="acc-head__text">
        <h2 className="acc-head__name">{name}</h2>
        <ul className="acc-head__tags" aria-label={t('modules.real_estate.tags')}>
          {member && <li className="acc-tag"><OwnerAvatar member={member} members={members} />{member}</li>}
          <li className="acc-tag"><i className="asset-map__swatch asset-tone--re" aria-hidden="true" />{classLabel('real_estate')}</li>
          <li className="acc-tag">{currency}</li>
          {purchaseDate && <li className="acc-tag">{t('modules.real_estate.bought', { date: fmtDayNumeric(purchaseDate) })}</li>}
        </ul>
      </div>
      {(enter || menu.length > 0) && (
        <div className="acc-head__actions re-head__actions">
          {enter && <button type="button" className={enter.quiet ? 'btn btn--ghost' : 'btn btn--primary'} onClick={enter.onClick}>{enter.label}</button>}
          {menu.length > 0 && <RowMenu label={name} ariaLabel={t('modules.real_estate.menu')} items={menu} />}
        </div>
      )}
    </div>
  )
}
