import {
  createContext,
  useContext,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import './Accordion.css'

export type AccordionMode =
  | 'single'
  | 'multiple'

export interface AccordionProps
  extends HTMLAttributes<HTMLDivElement> {
  mode?: AccordionMode
  defaultOpen?: string[]
  open?: string[]
  onOpenChange?: (open: string[]) => void
}

export interface AccordionItemProps
  extends HTMLAttributes<HTMLDivElement> {
  value: string
  disabled?: boolean
}

export interface AccordionTriggerProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode
}

export interface AccordionContentProps
  extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

interface AccordionContextValue {
  openItems: string[]
  toggleItem: (value: string) => void
  isDisabled: (value: string) => boolean
}

const AccordionContext =
  createContext<AccordionContextValue | null>(null)

const AccordionItemContext =
  createContext<{
    value: string
    disabled: boolean
  } | null>(null)

function useAccordionContext() {
  const context = useContext(AccordionContext)

  if (!context) {
    throw new Error(
      'Accordion components must be used inside Accordion',
    )
  }

  return context
}

function useAccordionItemContext() {
  const context = useContext(AccordionItemContext)

  if (!context) {
    throw new Error(
      'AccordionTrigger and AccordionContent must be used inside AccordionItem',
    )
  }

  return context
}

export function Accordion({
  mode = 'single',
  defaultOpen = [],
  open,
  onOpenChange,
  className = '',
  children,
  ...props
}: AccordionProps) {
  const [internalOpen, setInternalOpen] =
    useState<string[]>(defaultOpen)

  const openItems = open ?? internalOpen

  const setOpenItems = (next: string[]) => {
    if (open === undefined) {
      setInternalOpen(next)
    }

    onOpenChange?.(next)
  }

  const toggleItem = (value: string) => {
    const isOpen = openItems.includes(value)

    if (isOpen) {
      setOpenItems(
        openItems.filter((item) => item !== value),
      )
      return
    }

    if (mode === 'single') {
      setOpenItems([value])
      return
    }

    setOpenItems([...openItems, value])
  }

  const contextValue: AccordionContextValue = {
    openItems,
    toggleItem,
    isDisabled: () => false,
  }

  const classes = [
    'mb-accordion',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <AccordionContext.Provider
      value={contextValue}
    >
      <div
        className={classes}
        {...props}
      >
        {children}
      </div>
    </AccordionContext.Provider>
  )
}

export function AccordionItem({
  value,
  disabled = false,
  className = '',
  children,
  ...props
}: AccordionItemProps) {
  const classes = [
    'mb-accordion__item',
    disabled ? 'mb-accordion__item--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <AccordionItemContext.Provider
      value={{
        value,
        disabled,
      }}
    >
      <div
        className={classes}
        {...props}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  )
}

export function AccordionTrigger({
  className = '',
  children,
  type = 'button',
  ...props
}: AccordionTriggerProps) {
  const {
    openItems,
    toggleItem,
  } = useAccordionContext()

  const {
    value,
    disabled,
  } = useAccordionItemContext()

  const triggerId = useId()
  const contentId = `${triggerId}-content`
  const isOpen = openItems.includes(value)

  const classes = [
    'mb-accordion__trigger',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      aria-expanded={isOpen}
      aria-controls={contentId}
      onClick={() => toggleItem(value)}
      {...props}
    >
      <span className="mb-accordion__trigger-content">
        {children}
      </span>

      <span
        className={[
          'mb-accordion__icon',
          isOpen
            ? 'mb-accordion__icon--open'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      >
        +
      </span>
    </button>
  )
}

export function AccordionContent({
  className = '',
  children,
  ...props
}: AccordionContentProps) {
  const {
    openItems,
  } = useAccordionContext()

  const {
    value,
  } = useAccordionItemContext()

  const contentId = useId()
  const isOpen = openItems.includes(value)

  const classes = [
    'mb-accordion__content',
    isOpen
      ? 'mb-accordion__content--open'
      : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (!isOpen) {
    return null
  }

  return (
    <div
      id={contentId}
      className={classes}
      role="region"
      {...props}
    >
      <div className="mb-accordion__content-inner">
        {children}
      </div>
    </div>
  )
}
