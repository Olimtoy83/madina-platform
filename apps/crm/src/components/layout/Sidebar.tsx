import { NavLink } from 'react-router-dom'

interface SidebarItem {
  label: string
  path: string
}

const sidebarItems: SidebarItem[] = [
  {
    label: 'Dashboard',
    path: '/',
  },
  {
    label: 'Warehouse',
    path: '/warehouse',
  },
  {
    label: 'Движение склада',
    path: '/warehouse/movements',
  },
  {
    label: 'Purchases',
    path: '/purchases',
  },
  {
    label: 'Sales',
    path: '/sales',
  },
  {
    label: 'Отчёт по продажам',
    path: '/reports/sales',
  },
  {
    label: 'Clients',
    path: '/clients',
  },
  {
    label: 'Income',
    path: '/income',
  },
  {
    label: 'Accounting',
    path: '/accounting',
  },
  {
    label: 'Tasks',
    path: '/tasks',
  },
  {
    label: 'Statistics',
    path: '/statistics',
  },
]

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">MB</div>

        <div className="sidebar__brand-name">
          Madina CRM
        </div>
      </div>

      <nav
        className="sidebar__nav"
        aria-label="Main navigation"
      >
        {sidebarItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `sidebar__item${isActive ? ' sidebar__item--active' : ''
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
