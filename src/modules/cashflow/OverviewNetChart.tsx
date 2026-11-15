import { ThemedChart } from '../../components/charts/ThemedChart'
import { resolveColor } from '../../lib/chartColors'
import { useDashboard } from '../../lib/dashboardState'
import { PHONE, useMedia } from '../../lib/media'
import type { MonthlyTrendRow } from '../../lib/types'
import { buildNetOption } from './netOption'

const HEIGHT = 160

/** The twelve monthly bars of OverviewNetCard; loaded lazily by the card, so ECharts stays off the Overview's first load. */
export function OverviewNetChart({ rows }: { rows: MonthlyTrendRow[] }) {
  const { fmt } = useDashboard()
  const compact = useMedia(PHONE)
  return <ThemedChart buildOption={() => buildNetOption(rows, fmt, resolveColor, compact)} height={HEIGHT} />
}
