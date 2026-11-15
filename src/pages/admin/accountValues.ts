import type { AccountClass } from '../../domain/accounts'

/** What the account forms edit: the wizard's inline form, the new-account dialog and the edit panel */
export interface AccountFormValues { name: string; member: string; currency: string; class: AccountClass }

/** An account form before anything is typed; the member and the currency are filled by `withListDefaults` once the lists are known */
export const EMPTY_ACCOUNT: AccountFormValues = { name: '', member: '', currency: '', class: 'bank' }

/** An empty currency uses the listed family currency, then the first option; member uses the first: the lists may arrive after the form opens */
export function withListDefaults(values: AccountFormValues, members: string[], currencies: string[], familyCurrency = ''): AccountFormValues {
  return { ...values, member: values.member || members[0] || '', currency: values.currency || (currencies.includes(familyCurrency) ? familyCurrency : currencies[0]) || '' }
}

export type AccountFieldName = 'name' | 'member' | 'currency'

export function requiredAccountFields(values: AccountFormValues, policy: { memberRequired: boolean } = { memberRequired: false }): AccountFieldName[] {
  const missing: AccountFieldName[] = []
  if (!values.name.trim()) missing.push('name')
  if (policy.memberRequired && !values.member) missing.push('member')
  if (!values.currency) missing.push('currency')
  return missing
}
