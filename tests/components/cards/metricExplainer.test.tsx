import { fireEvent, screen } from '@testing-library/react'
import { MetricExplainer } from '../../../src/components/cards/MetricExplainer'
import { factLabel, metricFormula, metricMeaning } from '../../../src/lib/metricText'
import { explanationFacts } from '../../../src/lib/snapshotSelectors'
import { makeSnapshot } from '../../helpers/snapshot'
import { renderWithSnapshot, stubPrivacyOn } from '../../helpers/render'

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) })
afterEach(() => { vi.unstubAllGlobals() })

const s = makeSnapshot()
const facts = explanationFacts(s, 'growth_beyond_savings')
const notes = ['Latest month used, Jun 2031: from $100 with $9 saved to $110, +0.5% for the month', 'Left out, no cash-flow data: May 2030, Jun 2030']

function open() {
  const button = screen.getByRole('button', { name: 'How it is calculated: Growth beyond savings' })
  fireEvent.click(button)
  return button
}

describe('MetricExplainer', () => {
  it('starts closed: a named button and no panel', () => {
    renderWithSnapshot(<MetricExplainer metric="growth_beyond_savings" facts={facts} notes={notes} />, s)
    const button = screen.getByRole('button', { name: 'How it is calculated: Growth beyond savings' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('.explain__panel')).toBeNull()
  })

  it('opens with the meaning, the formula, every input, the notes and the caveat', () => {
    const { container } = renderWithSnapshot(<MetricExplainer metric="growth_beyond_savings" facts={facts} notes={notes} />, s)
    const button = open()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const panel = container.querySelector('.explain__panel')!
    expect(button).toHaveAttribute('aria-controls', panel.id)
    expect(panel.querySelector('.explain__hd')).toHaveTextContent('How it is calculated')
    expect(panel).toHaveTextContent(metricMeaning('growth_beyond_savings'))
    expect(panel).toHaveTextContent(metricFormula('growth_beyond_savings'))
    const labels = [...panel.querySelectorAll('dt')].map(el => el.textContent)
    expect(labels).toEqual(facts.map(factLabel))
    const values = [...panel.querySelectorAll('dd')].map(el => el.textContent)
    expect(values[0]).toBe('6.2%')
    expect(values[2]).toBe('$10,800')
    expect(values[4]).toBe('$7,731')
    expect(values[5]).toBe('12')
    for (const n of notes) expect(panel).toHaveTextContent(n)
    expect(panel.querySelector('.explain__caveat')).toHaveTextContent(/not only market return/)
  })

  it('closes on Escape and gives the focus back to the button', () => {
    renderWithSnapshot(<MetricExplainer metric="growth_beyond_savings" facts={facts} />, s)
    const button = open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.explain__panel')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('closes on a click outside, not on a click inside', () => {
    renderWithSnapshot(<div><p>outside</p><MetricExplainer metric="growth_beyond_savings" facts={facts} /></div>, s)
    open()
    fireEvent.mouseDown(document.querySelector('.explain__panel')!)
    expect(document.querySelector('.explain__panel')).not.toBeNull()
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(document.querySelector('.explain__panel')).toBeNull()
  })

  it('shows the caveat of capital growth, and none for a metric without one', () => {
    const { unmount } = renderWithSnapshot(<MetricExplainer metric="capital_growth" facts={explanationFacts(s, 'capital_growth')} />, s)
    fireEvent.click(screen.getByRole('button', { name: 'How it is calculated: Net worth growth per year' }))
    expect(document.querySelector('.explain__caveat')).toHaveTextContent(/your own savings/)
    unmount()
    renderWithSnapshot(<MetricExplainer metric="net_worth" facts={explanationFacts(s, 'net_worth')} />, s)
    fireEvent.click(screen.getByRole('button', { name: /How it is calculated/ }))
    expect(document.querySelector('.explain__panel')).not.toBeNull()
    expect(document.querySelector('.explain__caveat')).toBeNull()
  })

  it('hides the amounts in privacy mode and keeps percentages and counts', () => {
    stubPrivacyOn()
    const { container } = renderWithSnapshot(<MetricExplainer metric="growth_beyond_savings" facts={facts} />, s)
    open()
    const values = [...container.querySelectorAll('.explain__panel dd')].map(el => el.textContent)
    expect(values).toEqual(['6.2%', '•••', '•••', '•••', '•••', '12'])
  })
})
