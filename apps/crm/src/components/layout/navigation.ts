import type { Permission } from '@madina/auth/rbac'
import type { AuthUserResponse } from '@madina/api'
import { can } from '../../shared/auth/permissions'

export interface NavigationItem {
  label: string
  path: string
  permission: Permission
}

export const navigationItems: readonly NavigationItem[] = [
  { label: 'Главная', path: '/', permission: 'reports:read' },
  { label: 'Склад', path: '/warehouse', permission: 'commerce:read' },
  { label: 'Движение склада', path: '/warehouse/movements', permission: 'commerce:read' },
  { label: 'Поступления', path: '/purchases', permission: 'commerce:read' },
  { label: 'Продажи', path: '/sales', permission: 'commerce:read' },
  { label: 'Отчёт по продажам', path: '/reports/sales', permission: 'reports:read' },
  { label: 'Клиенты', path: '/clients', permission: 'clients:read' },
  { label: 'Доходы', path: '/income', permission: 'reports:read' },
  { label: 'Учёт', path: '/accounting', permission: 'reports:read' },
  { label: 'Задачи', path: '/tasks', permission: 'tasks:read' },
  { label: 'Статистика', path: '/statistics', permission: 'reports:read' },
]

export function getVisibleNavigationItems(
  user: AuthUserResponse | null,
): readonly NavigationItem[] {
  return navigationItems.filter((item) => can(user, item.permission))
}
