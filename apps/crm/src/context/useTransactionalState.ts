import { useContext } from 'react'
import { TransactionalStateContext } from './TransactionalStateContext'

export function useTransactionalState() {
  const context = useContext(TransactionalStateContext)

  if (!context) {
    throw new Error(
      'useTransactionalState must be used inside TransactionalStateProvider',
    )
  }

  return context
}
