import { signed } from '../../../lib/pageHelpers'
import { useMoney } from '../../../lib/privacy'

/** A signed whole amount in its currency ('+$16,500', '−€2,024'), masked in privacy mode: the page's deltas, neutral text */
export function useSignedMoney(): (value: number, currency: string) => string {
  const money = useMoney()
  return (value, currency) => signed(value, v => money(v, currency))
}
