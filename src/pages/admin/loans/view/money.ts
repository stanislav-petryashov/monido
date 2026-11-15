import { fmtCurrencyCents } from '../../../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../../../lib/privacy'

/** An amount to the cent in its currency ('2 569,75 $'), masked in privacy mode: the payments and the schedule */
export function useCents(): (value: number, currency: string) => string {
  const { hidden } = usePrivacy()
  return (value, currency) => (hidden ? PRIVACY_MASK : fmtCurrencyCents(value, currency))
}

/** A day 'YYYY-MM-DD' as a year with its fraction: the x of the loans' charts */
export const yearOf = (date: string) => Number(date.slice(0, 4)) + (Number(date.slice(5, 7)) - 1 + (Number(date.slice(8, 10)) - 1) / 31) / 12

/** The two neutral tones of the loans (`.ln-tone-*`), by place in the list */
export const loanTone = (i: number) => (i % 2 === 0 ? 'ln-tone-a' : 'ln-tone-b')
