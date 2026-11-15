import { render, screen } from '@testing-library/react'
import { WarningsBanner } from '../../src/components/WarningsBanner'
import { t } from '../../src/i18n/client'

describe('WarningsBanner', () => {
  it('renders nothing without warnings', () => {
    const { container } = render(<WarningsBanner warnings={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('lists every warning under a counter, as text from its code and params', () => {
    const params = { name: 'Quillmark Bank', member: 'Robin', month: '2031-05' }
    render(<WarningsBanner warnings={[
      { code: 'missing_balance', ref: 'Quillmark Bank|Robin', params },
      { code: 'fx_fallback', ref: 'RUB 2031-09-20', params: { currency: 'RUB', date: '2031-09-20', used: '2031-09-19' } },
    ]} />)
    expect(screen.getByText(/: 2$/, { selector: 'summary' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText(t('warnings.missing_balance', params))).toBeInTheDocument()
    expect(screen.getByText('No balance for “Quillmark Bank” (Robin) in 2031-05')).toBeInTheDocument()
  })
})
