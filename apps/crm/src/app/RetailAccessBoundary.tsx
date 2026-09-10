import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { canRetail } from '../shared/auth/retailPermissions'
import type { RetailCapability } from '@madina/retail'

interface RetailAccessBoundaryProps {
  capability: RetailCapability
  children: ReactNode
}

export function RetailAccessBoundary({
  capability,
  children,
}: RetailAccessBoundaryProps) {
  const { user } = useAuth()

  if (!canRetail(user, capability)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
