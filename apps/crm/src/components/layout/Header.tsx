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

export function Header() {
  const location = useLocation()
  const { logout, user } = useAuth()

  const title =
    pageTitles[location.pathname] ?? 'Madina CRM'

  return (
    <header className="app-header">
      <div className="app-header__title">
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
