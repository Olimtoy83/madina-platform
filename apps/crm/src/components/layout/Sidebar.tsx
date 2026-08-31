import { Link, NavLink } from 'react-router-dom'

import { useAuth } from '../../context/useAuth'
import { getVisibleNavigationItems } from './navigation'
// A CSS mask applies the approved CRM color without altering canonical geometry.
import brandMarkUrl from '../../../../../docs/brand/assets/b2-1-s1-pass5/signature-flow-diamond-b2-1-s1-pass5-master.svg'

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
      <Link
        className="sidebar__brand"
        to="/"
        onClick={onNavigate}
        aria-label="Madina Platform CRM — главная"
      >
        <span
          className="sidebar__logo"
          aria-hidden="true"
          style={{
            maskImage: `url(${brandMarkUrl})`,
            WebkitMaskImage: `url(${brandMarkUrl})`,
          }}
        />

        <div className="sidebar__brand-copy">
          <span className="sidebar__brand-overline">Madina Platform</span>
          <span className="sidebar__brand-name">CRM</span>
        </div>
      </Link>

      <span className="sidebar__nav-label">Рабочее пространство</span>

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
