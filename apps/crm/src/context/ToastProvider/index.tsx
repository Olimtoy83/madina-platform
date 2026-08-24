import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'
import { Toast } from '@madina/ui'
import type { ToastVariant } from '@madina/ui'

interface ToastItem {
  id: number
  variant: ToastVariant
  title?: string
  message?: string
}

interface ToastContextValue {
  showToast: (
    toast: Omit<ToastItem, 'id'>,
  ) => void
}

const ToastContext =
  createContext<ToastContextValue | null>(null)

interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({
  children,
}: ToastProviderProps) {
  const [toast, setToast] =
    useState<ToastItem | null>(null)

  const showToast = useCallback(
    (
      item: Omit<ToastItem, 'id'>,
    ) => {
      setToast({
        id: Date.now(),
        ...item,
      })
    },
    [],
  )

  return (
    <ToastContext.Provider
      value={{ showToast }}
    >
      {children}

      <Toast
        open={Boolean(toast)}
        onClose={() => setToast(null)}
        variant={
          toast?.variant ?? 'info'
        }
        title={toast?.title}
        message={toast?.message}
      />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context =
    useContext(ToastContext)

  if (!context) {
    throw new Error(
      'useToast must be used inside ToastProvider',
    )
  }

  return context
}