import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import './DropdownMenu.css'

export type DropdownMenuAlign =
  | 'start'
  | 'end'

export type DropdownMenuSize =
  | 'sm'
  | 'md'

export interface DropdownMenuItem {
  id: string
  label: ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
}

export interface DropdownMenuProps {
  items: DropdownMenuItem[]
  trigger?: ReactNode
  align?: DropdownMenuAlign
  size?: DropdownMenuSize
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function DropdownMenu({
  items,
  trigger = 'Actions',
  align = 'end',
  size = 'md',
  open: controlledOpen,
  onOpenChange,
}: DropdownMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const setOpen = (nextOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(nextOpen)
    }

    onOpenChange?.(nextOpen)
  }

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target

      if (
        target instanceof Node &&
        rootRef.current?.contains(target)
      ) {
        return
      }

      setOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener(
      'pointerdown',
      handlePointerDown,
    )
    document.addEventListener(
      'keydown',
      handleKeyDown,
    )

    return () => {
      document.removeEventListener(
        'pointerdown',
        handlePointerDown,
      )
      document.removeEventListener(
        'keydown',
        handleKeyDown,
      )
    }
  }, [open])

  const handleItemClick = (item: DropdownMenuItem) => {
    if (item.disabled) {
      return
    }

    item.onClick?.()
    setOpen(false)
  }

  return (
    <div
      ref={rootRef}
      className="mb-dropdown-menu"
    >
      <button
        type="button"
        className="mb-dropdown-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>

      {open && (
        <div
          className={[
            'mb-dropdown-menu__content',
            `mb-dropdown-menu__content--${align}`,
            `mb-dropdown-menu__content--${size}`,
          ].join(' ')}
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={[
                'mb-dropdown-menu__item',
                item.danger
                  ? 'mb-dropdown-menu__item--danger'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => handleItemClick(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
