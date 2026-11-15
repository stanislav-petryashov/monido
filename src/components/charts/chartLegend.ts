import { LegendComponent } from 'echarts/components'
import { core } from './echarts'

// Only the cash forecast (ForecastPanel) uses ECharts' built-in legend.
core.use([LegendComponent])
