import type { UserRole } from './types.js'

export type Permission =
  | 'clients:read'
  | 'clients:write'
  | 'tasks:read'
  | 'tasks:write'
  | 'commerce:read'
  | 'sales:write'
  | 'purchases:write'
  | 'products:write'
  | 'stock:adjust'
  | 'reports:read'
  | 'audit:read'
  | 'data:import'
  | 'users:manage'
  | 'korea-auto:read'
  | 'korea-auto:write'

const readPermissions: readonly Permission[] = [
  'clients:read',
  'tasks:read',
  'commerce:read',
  'reports:read',
  'korea-auto:read',
]

const operatorPermissions: readonly Permission[] = [
  ...readPermissions,
  'clients:write',
  'tasks:write',
  'sales:write',
  'korea-auto:write',
]

const managerPermissions: readonly Permission[] = [
  ...operatorPermissions,
  'purchases:write',
  'products:write',
  'stock:adjust',
]

export const rolePermissions: Readonly<Record<
  UserRole,
  readonly Permission[]
>> = {
  viewer: readPermissions,
  operator: operatorPermissions,
  manager: managerPermissions,
  admin: [
    ...managerPermissions,
    'audit:read',
    'data:import',
    'users:manage',
  ],
}

export function hasPermission(
  role: UserRole,
  permission: Permission,
): boolean {
  return rolePermissions[role].includes(permission)
}

export class PermissionDeniedError extends Error {
  constructor(permission: Permission) {
    super(`Permission denied: ${permission}`)
    this.name = 'PermissionDeniedError'
  }
}

export function requirePermission(
  role: UserRole,
  permission: Permission,
): void {
  if (!hasPermission(role, permission)) {
    throw new PermissionDeniedError(permission)
  }
}
