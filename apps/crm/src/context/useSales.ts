import { useContext } from 'react'
import { SalesContext } from './SalesContext'

export function useSales() {
  const context = useContext(SalesContext)

  if (!context) {
    throw new Error(
      'useSales must be used inside SalesProvider',
    )
  }

  return context
}
