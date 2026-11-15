import type { CSSProperties } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { SegmentedPills } from '../../components/ui/SegmentedPills'
import type { AssetChanges, GroupBy } from '../../domain/assetChanges'
import { fmtPct } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'
import { memberTint } from '../../components/ui/memberTint'
import { OwnerAvatar } from '../../components/ui/OwnerAvatar'
import { TONES, TYPES } from './tones'

const BY: readonly GroupBy[] = ['type', 'member', 'currency']
/** A currency's colour by its rank: the type tones in the page's order, so the list stays inside the asset palette */
const CURRENCY_TONES = TYPES.map(type => TONES[type][0])
/** A member's bar fill in their tint */
const toneOf = (tint: string) => ({ '--tone': `var(--${tint})` })

interface CompositionListProps {
  groups: AssetChanges['groups']
  /** The assets the shares are of: the headline's total */
  total: number
  totalKnown?: boolean
  by: GroupBy
  onBy: (by: GroupBy) => void
  fmt: (v: number) => string
  members: string[]
  /** What can be spent at once: `capital.liquid` */
  liquid: number
  /** «over the month»: the period of the changes; null — no period, no changes */
  overLabel: string | null
}

/**
 * What the assets are made of, by type, owner or currency: a row per group with its amount, its share as a long bar
 * and its change over the period; under them, how much is available at once. A dimension with one group is no choice.
 */
export function CompositionList({ groups: all, total, totalKnown = true, by, onBy, fmt, members, liquid, overLabel }: CompositionListProps) {
  const { t } = useTranslation()
  // a group only holdings closed in the period make: its change stays in the type's row, no empty row of its own
  const groups = Object.fromEntries(BY.map(b => [b, all[b].filter(g => g.count > 0 || g.valueBase !== 0)])) as AssetChanges['groups']
  const offered = BY.filter(b => groups[b].length > 1)
  const shown = offered.includes(by) ? by : 'type'
  const share = (v: number) => (total ? (v / total) * 100 : 0)
  // the sentence names the bank accounts only while they are what is available at once
  const bankOnly = Math.round(liquid) === Math.round(groups.type.find(g => g.key === 'bank')?.valueBase ?? 0)
  const nameOf = (key: string) => (shown === 'type' ? t(`pages.assets.type.${key}`) : shown === 'member' ? key || t('pages.netWorth.noMember') : key)

  return (
    <section className="card card--p" aria-labelledby="assets-composition">
      <div className="card-hd--row comp__head">
        <h2 className="card-hd" id="assets-composition">{t('pages.assets.compositionTitle')}</h2>
        {offered.length > 1 && (
          <SegmentedPills overflow="scroll" ariaLabel={t('pages.assets.compositionTitle')} items={offered} active={shown} onSelect={onBy} label={b => t(`pages.assets.by.${b}`)} />
        )}
      </div>
      <ul className="comp">
        {groups[shown].map((g, rank) => {
          const tone = shown === 'type' ? TONES[g.key as keyof typeof TONES][0] : CURRENCY_TONES[Math.min(rank, CURRENCY_TONES.length - 1)]
          // a member's bar in their tint, as their avatar; no member or a stranger in ink (assets.css)
          const fill: CSSProperties = { width: `${share(g.valueBase)}%` }
          const tint = shown === 'member' ? memberTint(g.key, members) : null
          if (tint) Object.assign(fill, toneOf(tint))
          const name = nameOf(g.key)
          return (
            <li key={g.key} className="comp__row">
              <span className="comp__name">
                {shown === 'member' ? <OwnerAvatar name={name} member={g.key} members={members} /> : <i className={`asset-map__swatch asset-tone--${tone}`} />}
                {name}
              </span>
              <span className="comp__val num">{g.valueKnown ? fmt(g.valueBase) : '—'}<span className="comp__share">{g.valueKnown && totalKnown ? fmtPct(share(g.valueBase)) : '—'}</span></span>
              <span className="comp__bar" aria-hidden="true">{g.valueKnown && totalKnown && <i className={shown === 'member' ? 'comp__fill' : `comp__fill asset-tone--${tone}`} style={fill} />}</span>
              <span className="comp__meta">
                {overLabel !== null && <><span className="num">{g.changeKnown ? signed(g.change, fmt) : '—'}</span>{` ${overLabel} · `}</>}
                {g.valueKnown ? t('pages.assets.holdings', { count: g.count }) : '—'}
              </span>
            </li>
          )
        })}
      </ul>
      {totalKnown && <p className="comp__liquid">
        <Trans i18nKey={bankOnly ? 'pages.assets.liquid' : 'pages.assets.liquidAny'} values={{ amount: fmt(liquid), share: fmtPct(share(liquid)) }} components={{ b: <b className="num" /> }} />
      </p>}
    </section>
  )
}
