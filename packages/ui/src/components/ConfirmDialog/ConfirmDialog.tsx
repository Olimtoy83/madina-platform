import type { ReactNode } from 'react'
import './ConfirmDialog.css'

import {
  Button,
  Modal,
  type ButtonVariant,
} from '../../index'

export type ConfirmDialogVariant =
  | 'default'
  | 'danger'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: ReactNode
  description?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  variant?: ConfirmDialogVariant
  loading?: boolean
  disabled?: boolean
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  disabled = false,
}: ConfirmDialogProps) {
  const confirmVariant: ButtonVariant =
    variant === 'danger'
      ? 'danger'
      : 'primary'

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      closeOnOverlayClick={!loading}
      closeOnEscape={!loading}
    >
      <div className="mb-confirm-dialog">
        <div className="mb-confirm-dialog__content">
          <h2 className="mb-confirm-dialog__title">
            {title}
          </h2>

          {description && (
            <div className="mb-confirm-dialog__description">
              {description}
            </div>
          )}
        </div>

        <div className="mb-confirm-dialog__actions">
          <Button
            variant="secondary"
            type="button"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </Button>

          <Button
            variant={confirmVariant}
            type="button"
            onClick={onConfirm}
            disabled={disabled || loading}
          >
            {loading ? 'Processing...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
