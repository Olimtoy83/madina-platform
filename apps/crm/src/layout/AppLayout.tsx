import { Outlet } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { Sidebar } from '../components/layout/Sidebar'
import { ClientsProvider } from '../context/ClientsProvider'
import { ProductsProvider } from '../context/ProductsProvider'
import { TasksProvider } from '../context/TasksProvider'
import { TransactionalStateProvider } from '../context/TransactionalStateProvider'
import { ToastProvider } from '../context/ToastProvider'
import { Drawer } from '@madina/ui'
import { useState } from 'react'

export function AppLayout() {
  const [isNavigationOpen, setIsNavigationOpen] = useState(false)

  return (
    <ToastProvider>
      <ClientsProvider>
        <TasksProvider>
          <TransactionalStateProvider>
            <ProductsProvider>
              <div className="app-layout">
                  <Sidebar />

                  <Drawer
                    open={isNavigationOpen}
                    onClose={() => setIsNavigationOpen(false)}
                    title="Навигация"
                    placement="left"
                    size="sm"
                    className="app-layout__navigation-drawer"
                  >
                    <Sidebar
                      mobile
                      onNavigate={() => setIsNavigationOpen(false)}
                    />
                  </Drawer>

                  <div className="app-layout__main">
                    <Header
                      onOpenNavigation={() => setIsNavigationOpen(true)}
                    />

                    <main className="app-layout__content">
                      <Outlet />
                    </main>
                  </div>
              </div>
            </ProductsProvider>
          </TransactionalStateProvider>
        </TasksProvider>
      </ClientsProvider>
    </ToastProvider>
  )
}
