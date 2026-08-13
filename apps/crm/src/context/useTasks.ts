import { useContext } from 'react'
import { TasksContext } from './TasksContext'

export function useTasks() {
  const context = useContext(
    TasksContext,
  )

  if (!context) {
    throw new Error(
      'useTasks must be used inside TasksProvider',
    )
  }

  return context
}
