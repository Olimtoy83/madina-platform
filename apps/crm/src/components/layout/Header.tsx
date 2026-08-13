import { useLocation } from 'react-router-dom'

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/clients': 'Clients',
  '/warehouse': 'Warehouse',
  '/warehouse/movements': 'Движение склада',
  '/purchases': 'Purchases',
  '/sales': 'Sales',
  '/income': 'Income',
  '/accounting': 'Accounting',
  '/tasks': 'Tasks',
  '/statistics': 'Statistics',
}

export function Header() {
  const location = useLocation()

  const title =
    pageTitles[location.pathname] ?? 'Madina CRM'

  return (
    <header className="app-header">
      <div className="app-header__title">
        <h1>{title}</h1>
      </div>

      <div className="app-header__actions">
        <span className="app-header__brand">
          Madina CRM
        </span>
      </div>
    </header>
  )
}