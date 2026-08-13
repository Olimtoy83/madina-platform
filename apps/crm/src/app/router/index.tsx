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


export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        path: 'clients',
        element: <Clients />,
      },
      {
        index: true,
        element: <Dashboard />,
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
    ],
  },
])
