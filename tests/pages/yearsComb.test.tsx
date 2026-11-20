import { fireEvent, screen, within } from '@testing-library/react'
import { YearsComb } from '../../src/pages/overview/YearsComb'
import { yearCells } from '../../src/domain/yearCells'
import { HIST, LONG_HIST } from '../helpers/history'
import { renderWithSnapshot, stubPrivacyOn } from '../helpers/render'

const TODAY = new Date('2026-11-07T12:00:00Z')
const fmt = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`

/** The window width: below 640px the comb shows one year with pills above it */
const width = (px: number, coarse = false) => vi.stubGlobal('matchMedia', vi.fn((query: string) => {
  const max = /max-width:\s*(\d+)px/.exec(query)
  return { matches: query === '(pointer: coarse)' ? coarse : max ? px <= Number(max[1]) : false, addEventListener() {}, removeEventListener() {} }
}))

const years = () => [...document.querySelectorAll<HTMLElement>('.comb__year')]

function draw(history = HIST, props: Partial<Parameters<typeof YearsComb>[0]> = {}) {
  const cells = yearCells(history, ['2026-10'], TODAY, new Set())
  const onSelect = vi.fn()
  const onOffset = vi.fn()
  const result = renderWithSnapshot(<YearsComb cells={cells} selected="2026-09" onSelect={onSelect} offset={0} onOffset={onOffset} fmt={fmt} {...props} />)
  return { ...result, cells, onSelect, onOffset }
}

beforeEach(() => width(1280))
afterEach(() => vi.unstubAllGlobals())

describe('YearsComb', () => {
  it('draws four year cells for the demo history, the current one marked, and no earlier control', () => {
    draw()
    const group = screen.getByRole('group', { name: 'Years of net worth' })
    expect(group).toHaveClass('comb')
    const cells = years()
    expect(cells).toHaveLength(4)
    expect(cells.map(c => c.querySelector('.comb__head')?.textContent)).toEqual([
      '2023$549,684', '2024$593,481', '2025$723,371', '2026 · in progress$758,673',
    ])
    expect(cells[3]).toHaveClass('comb__year--current')
    expect(cells[0]).not.toHaveClass('comb__year--current')
    expect(cells[0].querySelector('.comb__foot')).toHaveTextContent('+$15,595 over 3 months')
    expect(cells[1].querySelector('.comb__foot')).toHaveTextContent('+$43,797 over 12 months')
    expect(cells[1].querySelector('.delta')!.className).toBe('delta num')
    expect(cells[3].querySelector('.comb__foot')).toHaveTextContent('+$35,302 over 9 months')
    expect(screen.queryByRole('button', { name: 'Earlier' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
  })

  it('has twelve strokes per year, the selected one pressed; a click selects the month', () => {
    const { onSelect } = draw()
    const strokes = years()[1].querySelectorAll('.comb__stroke')
    expect(strokes).toHaveLength(12)
    expect(screen.getByRole('button', { name: 'Sep 2026' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'May 2024' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'May 2024' }))
    expect(onSelect).toHaveBeenCalledWith('2024-05')
  })

  it('scales the strokes\' bars over the whole history and leaves the months without data empty', () => {
    draw()
    const bar = (name: string) => screen.getByRole('button', { name }).querySelector<HTMLElement>('.comb__bar')!
    expect(parseFloat(bar('Oct 2023').style.height)).toBeLessThan(parseFloat(bar('Sep 2026').style.height))
    expect(bar('Sep 2026').style.height).toBe('34px')
    // the button is the full-height target; only the bar inside it has a height of its own
    expect(screen.getByRole('button', { name: 'Oct 2023' }).style.height).toBe('')
    const none = years()[0].querySelectorAll('.comb__stroke--none')
    expect(none).toHaveLength(9)
    expect(none[0]).toBeDisabled()
    expect(none[0]).toHaveAttribute('tabindex', '-1')
    expect(none[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('marks the open month with a dashed stroke and says so in its name', () => {
    draw()
    const open = screen.getByRole('button', { name: 'Oct 2026 · open' })
    expect(open).toHaveClass('comb__stroke--open')
    expect(open).not.toBeDisabled()
    // nothing to select: it is the way to the wizard, not a pressed state
    expect(open).not.toHaveAttribute('aria-pressed')
  })

  it('shows the Earlier and Later pair for five years, Earlier shifting the window back', () => {
    const { onOffset } = draw(LONG_HIST)
    expect(years()).toHaveLength(4)
    expect(years().map(c => c.querySelector('.comb__head')?.textContent?.slice(0, 4))).toEqual(['2024', '2025', '2026', '2027'])
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }))
    expect(onOffset).toHaveBeenCalledWith(1)
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled()
  })

  it('at the earliest window, Later shifts forward and Earlier is disabled', () => {
    const { onOffset } = draw(LONG_HIST, { offset: 1 })
    expect(years().map(c => c.querySelector('.comb__head')?.textContent?.slice(0, 4))).toEqual(['2023', '2024', '2025', '2026'])
    expect(screen.getByRole('button', { name: 'Earlier' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(onOffset).toHaveBeenCalledWith(0)
  })

  it('masks the head figure and the change in privacy mode', () => {
    stubPrivacyOn()
    width(1280)
    // the head figure is masked by the dashboard's `fmt` (useDashboard), as Overview passes it; the comb masks the signed change itself
    const { container } = draw(HIST, { fmt: () => '•••' })
    expect(container.textContent?.replace(/[^0-9]/g, '')).not.toContain('758673')
    expect(container.textContent?.replace(/[^0-9]/g, '')).not.toContain('43797')
    expect(years()[3].querySelector('.comb__head')).toHaveTextContent('•••')
    expect(years()[1].querySelector('.comb__foot')).toHaveTextContent('••• over 12 months')
  })

  it('reveals the selected touch month within its own track and retains accessible month names', () => {
    width(390, true)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(144)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(44)
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-label') === 'Sep 2026' ? 384 : 0
    })
    const { container } = draw()
    expect(container.querySelectorAll('.comb__month')).toHaveLength(12)
    expect(container.querySelector('.comb__month')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.comb__strokes')!.scrollLeft).toBe(284)
    expect(screen.getByRole('button', { name: 'Sep 2026' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('on a phone shows the current year alone with the years as pills above it', () => {
    width(390)
    draw()
    expect(years()).toHaveLength(1)
    expect(years()[0]).toHaveClass('comb__year--current')
    const pills = screen.getByRole('group', { name: 'Year' })
    expect(within(pills).getAllByRole('button').map(b => b.textContent)).toEqual(['2023', '2024', '2025', '2026'])
    expect(within(pills).getByRole('button', { name: '2026' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(pills).getByRole('button', { name: '2024' }))
    expect(years()).toHaveLength(1)
    expect(years()[0].querySelector('.comb__head')).toHaveTextContent('2024')
  })

  it('links a finished year to its page, not the year in progress, and only when a module gives the address', () => {
    const { unmount } = draw(HIST, { yearHref: y => (y === 2023 ? null : `/year/${y}`) })
    expect(screen.getByRole('link', { name: '2025: the year on Income and expenses' })).toHaveAttribute('href', '/year/2025')
    expect(screen.queryByRole('link', { name: /^2023/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /^2026/ })).toBeNull()
    expect(years()[3].querySelector('.comb__head')).toHaveTextContent('2026 · in progress')
    unmount()
    draw()
    expect(screen.queryByRole('link', { name: /the year on Income and expenses/ })).toBeNull()
  })
})

