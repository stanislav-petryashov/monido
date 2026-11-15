import { fireEvent, render, screen } from '@testing-library/react'
import { SegmentedPills } from '../../src/components/ui/SegmentedPills'

describe('SegmentedPills', () => {
  it('exposes a labelled group with the active item pressed', () => {
    render(<SegmentedPills ariaLabel="Currency" items={['USD', 'RUB', 'EUR']} active="RUB" onSelect={() => {}} />)
    expect(screen.getByRole('group', { name: 'Currency' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RUB' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'USD' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports the clicked item', () => {
    const onSelect = vi.fn()
    render(<SegmentedPills ariaLabel="Currency" items={['USD', 'RUB', 'EUR']} active="USD" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'EUR' }))
    expect(onSelect).toHaveBeenCalledWith('EUR')
  })
})
