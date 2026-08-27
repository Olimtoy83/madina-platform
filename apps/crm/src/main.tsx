import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@madina/ui'
import './index.css'
import './App.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
