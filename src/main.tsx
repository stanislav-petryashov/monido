import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest/index.css'
import './styles/tokens.css'
import './styles/record-charts.css'
import './styles/ui-surfaces.css'
import './styles/record-list.css'
import App from './App.tsx'
import { initClientI18n } from './i18n/client'

window.addEventListener('unhandledrejection', e => {
  console.error('[unhandledrejection]', e.reason)
})
window.addEventListener('error', e => {
  console.error('[error]', e.message, e.filename, e.lineno)
})

// the language must be known before the first render: no flash of English for a Russian user
await initClientI18n()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
