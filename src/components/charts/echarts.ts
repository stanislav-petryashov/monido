import * as core from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { LegacyGridContainLabel } from 'echarts/features'
import { SVGRenderer } from 'echarts/renderers'

// Shared charts: lines/bars/pies, grid, axis pointer and the SVG renderer (vector text stays sharp at any zoom or
// screen density; a canvas keeps the pixel ratio it was drawn at and blurs after a zoom or a move to another screen). Legend/mark-line
// components register synchronously in their lazy consumers, not in every chart page.
// LegacyGridContainLabel is the grid's `containLabel` option (the area, projection and net charts). A part missing here fails silently at run time:
// add it when an option builder starts using a new series type or component.
// All builders supply explicit descriptions, rendered by ThemedChart as current React aria text.
// No automatic ECharts descriptions or decal palettes are used by this app.
core.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegacyGridContainLabel, SVGRenderer])

export { core }
