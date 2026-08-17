import {
  useId,
  type ReactNode,
} from 'react'
import './Tabs.css'

export interface TabItem {
  id: string
  label: ReactNode
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  fullWidth?: boolean
}

export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  fullWidth = false,
}: TabsProps) {
  const generatedId = useId()

  const firstAvailableItem = items.find(
    (item) => !item.disabled,
  )

  const activeValue =
    value ??
    defaultValue ??
    firstAvailableItem?.id

  const handleChange = (nextValue: string) => {
    if (nextValue === activeValue) {
      return
    }

    onChange?.(nextValue)
  }

  const classes = [
    'mb-tabs',
    fullWidth ? 'mb-tabs--full-width' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <div
        className="mb-tabs__list"
        role="tablist"
      >
        {items.map((item) => {
          const active =
            item.id === activeValue

          return (
            <button
              key={item.id}
              type="button"
              id={`${generatedId}-tab-${item.id}`}
              className={[
                'mb-tabs__tab',
                active
                  ? 'mb-tabs__tab--active'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role="tab"
              aria-selected={active}
              aria-disabled={
                item.disabled || undefined
              }
              disabled={item.disabled}
              tabIndex={active ? 0 : -1}
              onClick={() =>
                handleChange(item.id)
              }
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
