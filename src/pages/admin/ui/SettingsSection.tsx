import { useId, type ReactNode } from 'react'

/**
 * One block of a settings screen: the title and a short description in a label column, the controls in a panel column.
 * Sections are split by a rule; under 900px the two columns stack. `stacked` puts the label above the panel at every width,
 * for a section whose panel is a wide table that needs the whole row.
 */
export function SettingsSection({ title, description, stacked, actions, children }: { title: string; description?: ReactNode; stacked?: boolean; actions?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section className={stacked ? 'settings-section settings-section--stacked' : 'settings-section'} aria-labelledby={id}>
      <div className="settings-section__label">
        <div className="settings-section__heading"><h2 id={id} className="settings-section__title">{title}</h2>{actions && <div className="settings-section__actions">{actions}</div>}</div>
        {description ? <p className="settings-section__text">{description}</p> : null}
      </div>
      <div className="settings-section__panel">{children}</div>
    </section>
  )
}
