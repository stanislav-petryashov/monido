import { Suspense, createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'
import { t } from '../../src/i18n/client'
import { lazyWithChunks } from '../../src/i18n/lazyWithChunks'
import advisorEn from '../../src/locales/advisor/en-US.json'

const TITLE = advisorEn.modules.advisor.use.title

const Page = () => <p>{t('modules.advisor.use.title')}</p>

/** A page module that fails to load `failures` times (a lost connection), then loads. */
function flaky(failures: number) {
  let left = failures
  return vi.fn(async () => {
    if (left-- > 0) throw new Error('offline')
    return { default: Page }
  })
}

const renderLazy = (load: ReturnType<typeof flaky>) =>
  render(<ErrorBoundary><Suspense fallback={null}>{createElement(lazyWithChunks(load, 'advisor'))}</Suspense></ErrorBoundary>)

describe('lazyWithChunks', () => {
  it('loads the page together with its chunk', async () => {
    renderLazy(flaky(0))
    expect(await screen.findByText(TITLE)).toBeInTheDocument()
  })

  it('tries once more when the page or a chunk fails to load', async () => {
    const load = flaky(1)
    renderLazy(load)
    expect(await screen.findByText(TITLE, undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a second failure reaches the error boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = flaky(2)
    renderLazy(load)
    expect(await screen.findByText(t('common.renderError'), undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
