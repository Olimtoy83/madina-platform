import { useLocation } from 'react-router-dom'

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