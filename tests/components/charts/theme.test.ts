vi.mock('../../../src/components/charts/echarts', () => import('../../helpers/echartsStub'))

describe('chart theme', () => {
  it('enlarges chart metadata and legends with the surrounding text', async () => {
    document.documentElement.style.fontSize = '32px'
    document.documentElement.style.setProperty('--fs-meta', '.75rem')
    document.documentElement.style.setProperty('--fs-sm', '.875rem')
    try {
      const { buildChartTheme } = await import('../../../src/components/charts/theme')
      const theme = buildChartTheme()
      expect(theme.categoryAxis.axisLabel.fontSize).toBe(24)
      expect(theme.legend.textStyle.fontSize).toBe(28)
      expect(theme.tooltip.textStyle.fontSize).toBe(28)
    } finally {
      for (const prop of ['font-size', '--fs-meta', '--fs-sm']) document.documentElement.style.removeProperty(prop)
    }
  })
  beforeEach(() => {
    vi.resetModules()
    document.documentElement.style.setProperty('--chart-1', '#7367F0')
    document.documentElement.style.setProperty('--text-3', 'rgb(47 43 61 / .55)')
  })
  afterEach(() => {
    document.documentElement.style.removeProperty('--chart-1')
    document.documentElement.style.removeProperty('--text-3')
  })

  it('builds a 6-color palette with no CSS variables left for canvas', async () => {
    const { buildChartTheme } = await import('../../../src/components/charts/theme')
    const theme = buildChartTheme()
    expect(theme.color).toHaveLength(6)
    expect(theme.color[0]).toBe('#7367F0')
    expect(theme.categoryAxis.axisLabel.color).toBe('rgba(47, 43, 61, 0.55)')
    // The tooltip is an HTML element: var() is fine in its extraCssText, nowhere else (canvas).
    const { extraCssText, ...canvasTooltip } = theme.tooltip
    expect(JSON.stringify({ ...theme, tooltip: canvasTooltip })).not.toContain('var(')
    expect(extraCssText).toContain('var(--shadow-md)')
  })

  it('draws gridlines in --rule, four of them, square-cornered bars and rect legend swatches', async () => {
    document.documentElement.style.setProperty('--rule', 'rgb(27 26 36 / .08)')
    document.documentElement.style.setProperty('--paper', '#FBFBFD')
    try {
      const { buildChartTheme } = await import('../../../src/components/charts/theme')
      const theme = buildChartTheme()
      expect(theme.valueAxis.splitLine.lineStyle.color).toBe('rgba(27, 26, 36, 0.08)')
      expect(theme.valueAxis.splitNumber).toBe(4)
      expect(theme.bar.itemStyle.borderRadius).toEqual([2, 2, 0, 0])
      expect(theme.pie.itemStyle).toEqual({ borderColor: '#FBFBFD', borderWidth: 3 })
      expect(theme.legend.icon).toBe('rect')
    } finally {
      document.documentElement.style.removeProperty('--rule')
      document.documentElement.style.removeProperty('--paper')
    }
  })

  it('registers each mode once and names it by mode', async () => {
    const { core } = await import('../../../src/components/charts/echarts')
    const { ensureChartTheme } = await import('../../../src/components/charts/theme')
    expect(ensureChartTheme('light')).toBe('vuexy-light')
    expect(ensureChartTheme('light')).toBe('vuexy-light')
    expect(ensureChartTheme('dark')).toBe('vuexy-dark')
    expect(core.registerTheme).toHaveBeenCalledTimes(2)
  })
})
