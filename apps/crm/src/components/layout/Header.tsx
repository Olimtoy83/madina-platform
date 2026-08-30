import { useLocation } from 'react-router-dom'
import { Button } from '@madina/ui'
import { useAuth } from '../../context/useAuth'

const pageTitles: Record<string, string> = {
  '/': 'Главная',
  '/clients': 'Клиенты',
  '/warehouse': 'Склад',
  '/warehouse/movements': 'Движение склада',
  '/purchases': 'Поступления',
  '/sales': 'Продажи',
  '/reports/sales': 'Отчёт по продажам',
  '/income': 'Доходы',
  '/accounting': 'Учёт',
  '/tasks': 'Задачи',
  '/statistics': 'Статистика',
}

interface HeaderProps {
  onOpenNavigation: () => void
}

export function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/clients/')) {
    return 'Клиенты'
  }

  if (pathname.startsWith('/sales/')) {
    return 'Продажи'
  }

  return pageTitles[pathname] ?? 'Madina CRM'
}

export function Header({
  onOpenNavigation,
}: HeaderProps) {
  const location = useLocation()
  const { logout, user } = useAuth()

  const title = getPageTitle(location.pathname)

  return (
    <header className="app-header">
      <div className="app-header__title">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="app-header__menu-button"
          onClick={onOpenNavigation}
          aria-label="Открыть навигацию"
        >
          Меню
        </Button>
        <h1>{title}</h1>
      </div>

      <div className="app-header__actions">
        <span className="app-header__brand">
          {user?.username ?? 'Madina CRM'}
        </span>
        <Button
          onClick={() => void logout()}
          size="sm"
          variant="secondary"
        >
          Выйти
        </Button>
      </div>
    </header>
  )
}
