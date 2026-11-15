import { useTranslation } from 'react-i18next'
import { buildMetricPromptBlocks, type PromptBlock } from './prompts'
import type { MetricKey } from '../../domain/metricCatalog'
import type { FinanceSnapshot } from '../../domain/types'
import { currentLanguage } from '../../i18n/client'
import { useDashboard } from '../../lib/dashboardState'
import { useSnapshot } from '../../lib/useFinanceData'

/** The currency's name in the UI language with its code ("Russian Ruble (RUB)"); a code Intl does not know stays as it is. */
function currencyName(code: string): string {
  let name = code
  try {
    name = new Intl.DisplayNames(currentLanguage(), { type: 'currency' }).of(code) ?? code
  } catch { /* an unknown code is named by itself */ }
  return name === code ? code : `${name} (${code})`
}

/** Accounts, properties, loans or cash-flow rows held in a currency other than the snapshot's. */
function hasConvertedAmounts(s: FinanceSnapshot): boolean {
  const held = [...(s.capital?.accounts ?? []), ...(s.capital?.realEstate ?? []), ...(s.capital?.loans ?? []), ...s.cashflow.rows]
  return held.some(row => row.currency !== s.baseCurrency)
}

/** The prompt builder (in blocks) for a metric on the current snapshot, in the snapshot's currency; null while there is no snapshot. */
export function useMetricPrompt(key: MetricKey): (() => PromptBlock[]) | null {
  useTranslation() // re-render on a language switch: the currency name follows it
  const snapshot = useSnapshot().data
  const { fmtPlain } = useDashboard() // a prompt always carries real amounts, even in privacy mode
  if (!snapshot) return null
  return () => buildMetricPromptBlocks(snapshot, key, {
    money: fmtPlain,
    currencyName: currencyName(snapshot.baseCurrency),
    converted: hasConvertedAmounts(snapshot),
  })
}
