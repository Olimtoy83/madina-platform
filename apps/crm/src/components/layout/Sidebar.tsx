import { NavLink } from 'react-router-dom'

interface SidebarItem {
  label: string
  path: string
}

const sidebarItems: SidebarItem[] = [
  {
    label: 'Главная',
    path: '/',
  },
  {
    label: 'Склад',
    path: '/warehouse',
  },
  {
    label: 'Движение склада',
    path: '/warehouse/movements',
  },
  {
    label: 'Поступления',
    path: '/purchases',
  },
  {
    label: 'Продажи',
    path: '/sales',
  },
  {
    label: 'Отчёт по продажам',
    path: '/reports/sales',
  },
  {
    label: 'Клиенты',
    path: '/clients',
  },
  {
    label: 'Доходы',
    path: '/income',
  },
  {
    label: 'Учёт',
    path: '/accounting',
  },
  {
    label: 'Задачи',
    path: '/tasks',
  },
  {
    label: 'Статистика',
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
        aria-label="Основная навигация"
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
