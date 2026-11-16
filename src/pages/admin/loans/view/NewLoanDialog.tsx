import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { UNREAD_DATE } from '../../dateMask'
import { FormDialog } from '../../ui/FormDialog'
import { revealUnreadDate } from '../../ui/revealUnreadDate'
import { termTooLong, type Fields } from '../loanForm'
import { LoanFormFields } from './LoanForm'

interface NewLoanDialogProps {
  data: Fields
  setData: Dispatch<SetStateAction<Fields>>
  currencies: string[]
  members: string[]
  /** The family currency when listed, else the first */
  defaultCurrency: string
  propertyNames: readonly string[]
  busy: boolean
  onSubmit: () => Promise<boolean>
  beforeCancel?: () => Promise<boolean>
  onCancel: () => void
}

/** A new loan in a dialog on `--raised`: the loan form's fields, `defaultCurrency` and the first member chosen. */
export function NewLoanDialog({ data, setData, currencies, members, defaultCurrency, propertyNames, busy, onSubmit, beforeCancel, onCancel }: NewLoanDialogProps) {
  const { t } = useTranslation()
  const [submitted, setSubmitted] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const submit = () => {
    setSubmitted(true)
    if (data.issue_date === UNREAD_DATE) {
      revealUnreadDate(root.current, t('data.loans.field.issue_date'))
      return false
    }
    // refused here, before any save: a save in flight disables the fields, and a disabled field loses the focus
    if (termTooLong(data)) {
      root.current?.querySelector<HTMLInputElement>('.term-input input')?.focus()
      return false
    }
    return onSubmit()
  }
  return (
    <FormDialog title={t('data.loans.newTitle')} submitLabel={t('data.common.save')} onSubmit={submit} busy={busy} beforeCancel={beforeCancel} onCancel={onCancel}>
      <div ref={root} className="ln-dialog">
        <LoanFormFields data={data} setData={setData} currencies={currencies} members={members} defaultCurrency={defaultCurrency} propertyNames={propertyNames} adding submitted={submitted} />
      </div>
    </FormDialog>
  )
}
