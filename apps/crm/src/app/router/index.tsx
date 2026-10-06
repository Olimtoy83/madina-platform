import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '../../layout/AppLayout'
import { Dashboard } from '../../pages/Dashboard/Dashboard'
import { Warehouse } from '../../pages/Warehouse/Warehouse'
import { Purchases } from '../../pages/Purchases/Purchases'
import { Sales } from '../../pages/Sales/Sales'
import { SaleDetails } from '../../pages/Sales/SaleDetails'
import { StockMovements } from '../../pages/Warehouse/StockMovements'
import { Income } from '../../pages/Income/Income'
import { Accounting } from '../../pages/Accounting/Accounting'
import { Tasks } from '../../pages/Tasks/Tasks'
import { Statistics } from '../../pages/Statistics/Statistics'
import { Clients } from '../../pages/Clients/Clients'
import { ClientDetails } from '../../pages/Clients/ClientDetails'
import { SalesReport } from '../../pages/SalesReport/SalesReport'
import { RetailPos } from '../../pages/RetailPos/RetailPos'
import { OfflineOperations } from '../../pages/OfflineOperations/OfflineOperations'
import { TerminalSetup } from '../../pages/TerminalSetup/TerminalSetup'
import { RetailSalesJournal } from '../../pages/RetailSales/RetailSalesJournal'
import { RetailSaleDetail } from '../../pages/RetailSales/RetailSaleDetail'
import { RetailInventory } from '../../pages/RetailInventory/RetailInventory'
import { RetailGoodsReceipts } from '../../pages/RetailGoodsReceipts/RetailGoodsReceipts'
import { RetailAccessBoundary } from '../RetailAccessBoundary'
import { RouteRecovery } from '../RouteRecovery'
import { navigationProfile } from '../navigationProfile'
import { RetailWorkspaceHome } from '../RetailWorkspaceHome'


export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteRecovery />,
    children: [
      {
        path: 'clients',
        element: <Clients />,
      },
      {
        index: true,
        element: navigationProfile === 'sabono-retail'
          ? <RetailWorkspaceHome />
          : <Dashboard />,
      },
      {
        path: 'warehouse',
        element: <Warehouse />,
      },
      {
        path: 'purchases',
        element: <Purchases />,
      },
      {
        path: 'sales',
        element: <Sales />,
      },
      {
        path: 'reports/sales',
        element: <SalesReport />,
      },
      {
        path: 'income',
        element: <Income />,
      },
      {
        path: 'accounting',
        element: <Accounting />,
      },
      {
        path: 'sales/:saleId',
        element: <SaleDetails />,
      },
      {
        path: 'warehouse/movements',
        element: <StockMovements />,
      },
      {
        path: 'tasks',
        element: <Tasks />,
      },
      {
        path: 'statistics',
        element: <Statistics />,
      },
      {
        path: 'clients/:clientId',
        element: <ClientDetails />,
      },
      {
        path: 'retail/pos',
        element: (
          <RetailAccessBoundary capability="retail:sales:manage">
            <RetailPos />
          </RetailAccessBoundary>
        ),
      },
      {
        path: 'retail/sales',
        element: (
          <RetailAccessBoundary capability="retail:sales:read">
            <RetailSalesJournal />
          </RetailAccessBoundary>
        ),
      },
      {
        path: 'retail/sales/:saleId',
        element: (
          <RetailAccessBoundary capability="retail:sales:read">
            <RetailSaleDetail />
          </RetailAccessBoundary>
        ),
      },
      {
        path: 'retail/inventory',
        element: <RetailAccessBoundary capability="retail:inventory:read"><RetailInventory /></RetailAccessBoundary>,
      },
      {
        path: 'retail/goods-receipts',
        element: <RetailAccessBoundary capability="retail:goods-receipts:read"><RetailGoodsReceipts /></RetailAccessBoundary>,
      },
      {
        path: 'retail/offline-operations',
        element: (
          <RetailAccessBoundary capability="retail:sales:read">
            <OfflineOperations />
          </RetailAccessBoundary>
        ),
      },
      {
        path: 'retail/terminal-setup',
        element: (
          <RetailAccessBoundary capability="retail:offline-terminals:manage">
            <TerminalSetup />
          </RetailAccessBoundary>
        ),
      },
      {
        path: '*',
        element: <RouteRecovery notFound />,
      },
    ],
  },
])
