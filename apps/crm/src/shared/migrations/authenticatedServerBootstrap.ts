import type { AuthUserResponse } from '@madina/api'
import { bootstrapClientsToServer } from './clientServerBootstrap'
import { bootstrapCommerceToServer } from './commerceServerBootstrap'
import { bootstrapTasksToServer } from './taskServerBootstrap'

export interface AuthenticatedServerBootstrapResult {
  skipped: boolean
}

export async function bootstrapAuthenticatedServerData(
  user: AuthUserResponse,
): Promise<AuthenticatedServerBootstrapResult> {
  if (user.role !== 'admin') {
    return { skipped: true }
  }

  await bootstrapClientsToServer()
  await bootstrapTasksToServer()
  await bootstrapCommerceToServer()

  return { skipped: false }
}
