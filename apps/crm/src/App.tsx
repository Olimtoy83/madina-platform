import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthenticationBoundary } from './app/AuthenticationBoundary'
import { AuthProvider } from './context/AuthProvider'
import { useAuth } from './context/useAuth'
import { syncPendingOfflineSales } from './shared/offline/offlineSaleSync'

function OfflineSyncRunner() {
  const auth = useAuth()
  useEffect(() => {
    if (auth.isLoading || auth.error || !auth.user || (auth.user.role !== 'admin' && auth.user.role !== 'manager')) return
    let cancelled = false
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = (resumeAccessHolds: boolean) => {
      if (cancelled || running || !navigator.onLine) return
      running = true
      void syncPendingOfflineSales({ resumeAccessHolds }).then(result => {
        if (!cancelled) timer = setTimeout(() => run(false), result.nextAttemptAt === undefined ? 60_000 : Math.max(0, result.nextAttemptAt - Date.now()))
      }).catch(() => { if (!cancelled) timer = setTimeout(() => run(false), 60_000) }).finally(() => { running = false })
    }
    const online = () => { if (timer) clearTimeout(timer); run(true) }
    window.addEventListener('online', online)
    run(true)
    return () => { cancelled = true; if (timer) clearTimeout(timer); window.removeEventListener('online', online) }
  }, [auth.isLoading, auth.error, auth.user?.id, auth.user?.role])
  return null
}

function App() {
  return (
    <AuthProvider>
      <OfflineSyncRunner />
      <AuthenticationBoundary>
        <RouterProvider router={router} />
      </AuthenticationBoundary>
    </AuthProvider>
  )
}

export default App
