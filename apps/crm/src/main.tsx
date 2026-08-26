import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import '@madina/ui'
import './index.css'
import './App.css'
import { router } from './app/router/index'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'
import { bootstrapClientsToServer } from './shared/migrations/clientServerBootstrap'
import { bootstrapTasksToServer } from './shared/migrations/taskServerBootstrap'

try {
  await bootstrapClientsToServer()
  await bootstrapTasksToServer()
} catch (error) {
  console.error(
    'Failed to bootstrap CRM data to server',
    error,
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
)
