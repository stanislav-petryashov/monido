import { IconCheck } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useMedia } from '../../lib/media'
import type { StepProps } from './SetupBar'
import { DisclosureChevron } from '../../components/ui/DisclosureChevron'

export function Stepper({ wizard }: StepProps) {
  const { t } = useTranslation()
  const short = useMedia('(max-width: 760px)')
  const title = t(`data.setup.step.${wizard.step}`)
  const line = wizard.count > 0 ? t('data.setup.stepOf', { n: wizard.index, count: wizard.count, title }) : title
  const list = wizard.steps.length > 0 && (
    <ol className="setup-steps" aria-label={t('data.setup.steps')}>
      {wizard.steps.map((key, i) => {
        const name = t(`data.setup.step.${key}`)
        const done = i + 1 < wizard.index
        const number = <span className="setup-steps__number" aria-hidden="true">{done ? <IconCheck size={14} stroke={2} /> : i + 1}</span>
        return (
          <li key={key} aria-current={key === wizard.step ? 'step' : undefined}>
            {done ? <button type="button" className="setup-steps__jump" aria-label={`${name} ${t('data.setup.stepDone')}`} onClick={() => wizard.jump(key)}>
              {number}<span>{name}</span><span className="sr-only">{' '}{t('data.setup.stepDone')}</span>
            </button> : <span className="setup-steps__item">{number}{name}</span>}
          </li>
        )
      })}
    </ol>
  )
  return (
    <div className={short ? 'setup-steps--short' : undefined}>
      {short && wizard.count > 0 && <progress className="setup-progress" value={wizard.index} max={wizard.count} aria-label={line} />}
      <p className="sr-only" aria-live="polite">{line}</p>
      {short && list ? <details><summary className="setup-steps__toggle">{line}<DisclosureChevron size={16} /></summary>{list}</details> : list}
    </div>
  )
}
