import {
  hasRetailCapability,
  type RetailCapability,
} from '@madina/retail'
import type { AuthUserResponse } from '@madina/api'

export function canRetail(
  user: AuthUserResponse | null,
  capability: RetailCapability,
): boolean {
  return user !== null && hasRetailCapability(
    user.role,
    capability,
  )
}
