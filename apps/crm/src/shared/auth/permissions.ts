import {
  hasPermission,
  type Permission,
} from '@madina/auth/rbac'
import type { AuthUserResponse } from '@madina/api'

export function can(
  user: AuthUserResponse | null,
  permission: Permission,
): boolean {
  return user !== null && hasPermission(
    user.role,
    permission,
  )
}
