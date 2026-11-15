import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { memberTint } from '../../components/ui/memberTint'
import { OwnerAvatar } from '../../components/ui/OwnerAvatar'
import { SegmentedBar } from '../../components/ui/SegmentedBar'
import { memberSplit } from '../../domain/overviewBlocks'
import { useDashboard } from '../../lib/dashboardState'
import { useSnapshot } from '../../lib/useFinanceData'

/** The bar of no member or a stranger */
const INK = 'ink'

/** The core card on Overview: a lane per owner of the assets — the initial, the name, the share as a bar, the amount — and their largest holdings. */
export function WhoseAssetsCard() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const s = useSnapshot().data
  if (!s?.capital) return null
  const lanes = memberSplit(s.capital)
  const nameOf = (member: string) => member || t('pages.netWorth.noMember')
  const holdings = lanes
    .filter(l => l.largest.length > 0)
    .map(l => t('pages.overview.largestHoldings', { name: nameOf(l.member), holdings: l.largest.join(', ') }))
    .join(' · ')
  return (
    <Card className="whose">
      <div className="card-hd--row">
        <span className="card-hd">{t('pages.overview.whoseAssets')}</span>
        <span className="overview-card-meta">{fmt(s.capital.assets)}</span>
      </div>
      <ul className="lanes">
        {lanes.map(l => {
          const tone = memberTint(l.member, s.members) ?? INK
          const name = nameOf(l.member)
          return (
            <li key={l.member} className="lane">
              <span className="lane__who">
                <OwnerAvatar member={l.member} members={s.members} name={name} />
                <span className="lane__name" title={name}>{name}</span>
              </span>
              <SegmentedBar tone={tone} pct={l.sharePct} label={name} />
              <strong className="lane__amount num">{fmt(l.valueBase)}</strong>
            </li>
          )
        })}
      </ul>
      {holdings && <p className="lane-meta">{holdings}</p>}
    </Card>
  )
}
