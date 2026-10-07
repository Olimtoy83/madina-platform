import type { Permission } from '@madina/auth/rbac'
import type { AuthUserResponse } from '@madina/api'
import type { RetailCapability } from '@madina/retail'
import {
  navigationProfile,
  type NavigationProfile,
} from '../../app/navigationProfile'
import { can } from '../../shared/auth/permissions'
import { canRetail } from '../../shared/auth/retailPermissions'

interface BaseNavigationItem {
  label: string
  path: string
}

interface CrmNavigationItem extends BaseNavigationItem {
  permission: Permission
  retailCapability?: never
}

interface RetailNavigationItem extends BaseNavigationItem {
  permission?: never
  retailCapability: RetailCapability
}

export type NavigationItem =
  | CrmNavigationItem
  | RetailNavigationItem

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
  {
    label: 'Розничная касса',
    path: '/retail/pos',
    retailCapability: 'retail:sales:manage',
  },
  {
    label: 'Журнал розничных продаж',
    path: '/retail/sales',
    retailCapability: 'retail:sales:read',
  },
  {
    label: 'Розница: товары',
    path: '/retail/products',
    retailCapability: 'retail:products:read',
  },
  {
    label: 'Розница: остатки',
    path: '/retail/inventory',
    retailCapability: 'retail:inventory:read',
  },
  {
    label: 'Розница: поступления',
    path: '/retail/goods-receipts',
    retailCapability: 'retail:goods-receipts:read',
  },
  {
    label: 'Офлайн-операции',
    path: '/retail/offline-operations',
    retailCapability: 'retail:sales:read',
  },
  {
    label: 'Подготовка терминала',
    path: '/retail/terminal-setup',
    retailCapability: 'retail:offline-terminals:manage',
  },
]

const sabonoRetailLabels: Readonly<Record<string, string>> = {
  '/retail/pos': 'Касса',
  '/retail/sales': 'Продажи',
  '/retail/products': 'Товары',
  '/retail/inventory': 'Остатки',
  '/retail/goods-receipts': 'Поступления',
}

function itemsForProfile(
  profile: NavigationProfile,
): readonly NavigationItem[] {
  if (profile === 'default') {
    return navigationItems
  }

  return navigationItems
    .filter((item) => Object.hasOwn(sabonoRetailLabels, item.path))
    .map((item) => ({
      ...item,
      label: sabonoRetailLabels[item.path]!,
    }))
}

export function getVisibleNavigationItems(
  user: AuthUserResponse | null,
  profile: NavigationProfile = navigationProfile,
): readonly NavigationItem[] {
  return itemsForProfile(profile).filter((item) => {
    if (item.retailCapability !== undefined) {
      return canRetail(user, item.retailCapability)
    }

    return can(user, item.permission)
  })
}

export function getWorkspaceHomePath(
  user: AuthUserResponse | null,
  profile: NavigationProfile = navigationProfile,
): string | undefined {
  return getVisibleNavigationItems(user, profile)[0]?.path
}
