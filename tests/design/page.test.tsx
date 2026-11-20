import copy from '../../design/locales/ru-RU.json'
import { fireEvent, render, screen } from '@testing-library/react'
import { directory, relatedEntries } from '../../design/directory'
import { ENTRIES } from '../../design/registry'
import { Catalog } from '../../design/Catalog'
import { DesignProviders } from '../../design/providers'
import { designClient } from '../../design/setup'
import { useSnapshot } from '../../src/lib/useFinanceData'
import { settled } from '../helpers/render'

function Probe() {
  const { data } = useSnapshot()
  return <p>{data ? `net worth ${data.capital?.netWorth}` : 'loading'}</p>
}

// The catalog runs with no dev server and no sign-in: every query a component makes is already in the cache
describe('the design catalog providers', () => {
  it('serve the fixed snapshot without a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = designClient()
    render(<DesignProviders client={client}><Probe /></DesignProviders>)
    expect(await screen.findByText(/^net worth \d/)).toBeInTheDocument()
    await settled(client)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('catalog navigation', () => {
  afterEach(() => { window.history.replaceState(null, '', '/') })

  it('lists every canonical registry entry once in the directory or alongside its component', () => {
    const names = [...Object.values(directory).flatMap(Object.keys), ...Object.keys(relatedEntries)]
    expect(names.sort()).toEqual(ENTRIES.filter(e => !e.duplicateOf).map(e => e.name).sort())
    for (const parent of Object.values(relatedEntries)) expect(names).toContain(parent)
  })

  it('changes the real preview width without reloading the sample', () => {
    render(<Catalog />)
    const frame = screen.getByTitle(Object.values(directory).find(items => items.Switch)!.Switch)
    for (const [name, width] of [[copy.phone, '390'], [copy.tablet, '768'], [copy.desktop, '1440']]) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(screen.getByTitle(Object.values(directory).find(items => items.Switch)!.Switch)).toBe(frame)
      expect(frame).toHaveAttribute('width', width)
    }
  })

  it('opens a legacy component link and its source dialog', async () => {
    window.history.replaceState(null, '', '/design/#e-Switch')
    render(<Catalog />)
    expect(screen.getByRole('heading', { name: Object.values(directory).find(items => items.Switch)!.Switch })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: copy.code }))
    expect(screen.getByRole('dialog', { name: 'Switch' })).toHaveTextContent('src/components/ui/Switch.tsx')
    expect(await screen.findByText(/export function Switch/)).toBeInTheDocument()
  })

  it('keeps CSS entries with no standalone preview accessible', () => {
    window.history.replaceState(null, '', '/design/#e-select')
    render(<Catalog />)
    expect(screen.getByRole('heading', { name: '.select' })).toBeInTheDocument()
    expect(screen.queryByRole('figure')).toBeNull()
    expect(screen.getByRole('button', { name: copy.code })).toBeInTheDocument()
  })
})
