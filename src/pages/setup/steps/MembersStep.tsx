import { useId, useMemo, type FormEvent } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Member } from '../../admin/shared'
import { MembersBlock } from '../../admin/MembersBlock'
import { useAdminRows } from '../../admin/useAdminRows'
import { AdminReadNotice } from '../../admin/ui/AdminReadNotice'
import { SetupBar, type StepProps } from '../SetupBar'
import { keepAddFieldEnter } from '../addFieldEnter'

const noop = () => {}

/**
 * Step 3: whose accounts are tracked. Each edit is written by MembersBlock; Next is enabled once a member exists.
 */
export function MembersStep({ wizard }: StepProps) {
  const { t } = useTranslation()
  const Heading = wizard.again ? 'h2' : 'h1'
  const rows = useAdminRows<Member>('members')
  const members = useMemo(() => [...rows.rows].sort((a, b) => a.name.localeCompare(b.name)), [rows.rows])
  const hintId = useId()
  const empty = members.length === 0
  const writes = useIsMutating()
  // a read that failed must not read as "no members": the family may have them (and Next would stay off for good)
  const failed = rows.query.isError && !rows.query.data

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!empty && !writes) wizard.next()
  }
  return (
    <form className="form-stack" onSubmit={submit} onKeyDown={keepAddFieldEnter}>
      <Heading className="setup-card__title" tabIndex={-1}>{t('data.setup.members.title')}</Heading>
      <p className="setup-card__intro">{t('data.setup.members.text')}</p>
      {/* onAdded makes a duplicate (409) count as added, without an error toast */}
      <AdminReadNotice queries={[rows.query]} />
      {rows.query.data !== undefined && <MembersBlock members={members} inputLabel={t('data.setup.members.name')} onAdded={noop} />}
      {empty && rows.loaded && !failed && <p id={hintId} className="note setup-members-hint">{t('data.setup.members.needOne')}</p>}
      <SetupBar onBack={wizard.back} primary={t('data.setup.next')} disabled={empty || writes > 0} describedBy={empty && rows.loaded && !failed ? hintId : undefined} />
    </form>
  )
}
