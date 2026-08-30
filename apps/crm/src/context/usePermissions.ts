import type { Permission } from '@madina/auth/rbac'
import { can } from '../shared/auth/permissions'
import { useAuth } from './useAuth'

export function usePermissions() {
  const { user } = useAuth()

  return {
    can: (permission: Permission) => can(user, permission),
  }
}
