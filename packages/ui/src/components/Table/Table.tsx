import type {
  HTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
  TableHTMLAttributes,
  ReactNode,
} from 'react'
import './Table.css'

export interface TableProps
  extends TableHTMLAttributes<HTMLTableElement> {
  children?: ReactNode
}

export interface TableHeadProps
  extends HTMLAttributes<HTMLTableSectionElement> {
  children?: ReactNode
}

export interface TableBodyProps
  extends HTMLAttributes<HTMLTableSectionElement> {
  children?: ReactNode
}

export interface TableRowProps
  extends HTMLAttributes<HTMLTableRowElement> {
  children?: ReactNode
}

export interface TableHeaderProps
  extends ThHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode
}

export interface TableCellProps
  extends TdHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode
}

export function Table({
  className = '',
  children,
  ...props
}: TableProps) {
  const classes = [
    'mb-table',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="mb-table__wrapper">
      <table
        className={classes}
        {...props}
      >
        {children}
      </table>
    </div>
  )
}

export function TableHead({
  className = '',
  children,
  ...props
}: TableHeadProps) {
  const classes = [
    'mb-table__head',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <thead
      className={classes}
      {...props}
    >
      {children}
    </thead>
  )
}

export function TableBody({
  className = '',
  children,
  ...props
}: TableBodyProps) {
  const classes = [
    'mb-table__body',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <tbody
      className={classes}
      {...props}
    >
      {children}
    </tbody>
  )
}

export function TableRow({
  className = '',
  children,
  ...props
}: TableRowProps) {
  const classes = [
    'mb-table__row',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <tr
      className={classes}
      {...props}
    >
      {children}
    </tr>
  )
}

export function TableHeader({
  className = '',
  children,
  ...props
}: TableHeaderProps) {
  const classes = [
    'mb-table__header',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <th
      className={classes}
      {...props}
    >
      {children}
    </th>
  )
}

export function TableCell({
  className = '',
  children,
  ...props
}: TableCellProps) {
  const classes = [
    'mb-table__cell',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <td
      className={classes}
      {...props}
    >
      {children}
    </td>
  )
}
