import { Component, type ReactNode } from 'react'
import { t } from '../i18n/client'
import { Disclosure } from './ui/Disclosure'

interface Props {
  children: ReactNode
  /** A small answer for a part of the page; without it the page offers recovery and optional diagnostic details */
  fallback?: ReactNode
}
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback
    return (
      <div className="error-boundary">
        <div className="error-boundary__title" role="alert">{t('common.renderError')}</div>
        <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>{t('common.reloadPage')}</button>
        <Disclosure variant="inline" title={t('common.errorDetails')}>
          <pre className="error-boundary__stack">{error.message}{'\n\n'}{error.stack}</pre>
        </Disclosure>
      </div>
    )
  }
}
