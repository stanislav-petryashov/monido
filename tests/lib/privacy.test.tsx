import { fireEvent, render, screen } from '@testing-library/react'
import { PRIVACY_MASK, PRIVACY_STORAGE_KEY, usePrivacy } from '../../src/lib/privacy'
import { PrivacyProvider } from '../../src/lib/PrivacyProvider'
import { PrivacyToggle } from '../../src/components/layout/PrivacyToggle'
import { stubStorage } from '../helpers/storage'

function Probe() {
  const { hidden } = usePrivacy()
  return <output>{hidden ? PRIVACY_MASK : 'shown'}</output>
}
const renderApp = () => render(<PrivacyProvider><PrivacyToggle /><Probe /></PrivacyProvider>)

describe('privacy mode', () => {
  it('is off by default', () => {
    stubStorage('local')
    renderApp()
    expect(screen.getByRole('button', { name: 'Hide amounts' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('shown')
  })

  it('remembers the choice in this browser', () => {
    const data = stubStorage('local')
    const first = renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Hide amounts' }))
    expect(data.get(PRIVACY_STORAGE_KEY)).toBe('1')
    expect(screen.getByRole('button', { name: 'Show amounts' })).toHaveAttribute('aria-pressed', 'true')
    first.unmount()
    renderApp()
    expect(screen.getByRole('status')).toHaveTextContent(PRIVACY_MASK)
    fireEvent.click(screen.getByRole('button', { name: 'Show amounts' }))
    expect(data.has(PRIVACY_STORAGE_KEY)).toBe(false)
  })
})
