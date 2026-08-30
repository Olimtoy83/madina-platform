import { NavLink } from 'react-router-dom'

import { useAuth } from '../../context/useAuth'
import { getVisibleNavigationItems } from './navigation'

interface SidebarProps {
  onNavigate?: () => void
  mobile?: boolean
}

export function Sidebar({
  onNavigate,
  mobile = false,
}: SidebarProps) {
  const { user } = useAuth()
  const visibleItems = getVisibleNavigationItems(user)

  return (
    <aside className={`sidebar${mobile ? ' sidebar--mobile' : ''}`}>
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
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
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
