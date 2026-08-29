import { Outlet } from 'react-router-dom'
import { Header } from '../components/layout/Header'
import { Sidebar } from '../components/layout/Sidebar'
import { ClientsProvider } from '../context/ClientsProvider'
import { ProductsProvider } from '../context/ProductsProvider'
import { PurchasesProvider } from '../context/PurchasesProvider'
import { SalesProvider } from '../context/SalesProvider'
import { TasksProvider } from '../context/TasksProvider'
import { TransactionalStateProvider } from '../context/TransactionalStateProvider'
import { ToastProvider } from '../context/ToastProvider'

export function AppLayout() {
  return (
    <ToastProvider>
      <ClientsProvider>
        <TasksProvider>
          <TransactionalStateProvider>
            <ProductsProvider>
              <PurchasesProvider>
                <SalesProvider>
                  <div className="app-layout">
                    <Sidebar />

                    <div className="app-layout__main">
                      <Header />

                      <main className="app-layout__content">
                        <Outlet />
                      </main>
                    </div>
                  </div>
                </SalesProvider>
              </PurchasesProvider>
            </ProductsProvider>
          </TransactionalStateProvider>
        </TasksProvider>
      </ClientsProvider>
    </ToastProvider>
  )
}
