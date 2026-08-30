import { useMemo, useState } from 'react'
import { useTasks } from '../../context/useTasks'
import { useToast } from '../../context/ToastProvider'
import { usePendingCommand } from '../../shared/usePendingCommand'
import {
  getTaskStats,
  type TaskPriority,
  type TaskStatus,
} from '@madina/core'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@madina/ui'
import './Tasks.css'

const priorityLabels: Record<TaskPriority, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
}

export function Tasks() {
  const {
    tasks,
    isLoading,
    loadError,
    addTask,
    updateTask,
    deleteTask,
  } = useTasks()
  const { showToast } = useToast()
  const { isPending, run } = usePendingCommand()

  const [isFormOpen, setIsFormOpen] =
    useState(false)

  const [taskToDelete, setTaskToDelete] =
    useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] =
    useState('')
  const [priority, setPriority] =
    useState<TaskPriority>('medium')
  const [status, setStatus] =
    useState<TaskStatus>('todo')
  const [dueDate, setDueDate] = useState('')

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          b.createdAt.getTime() -
          a.createdAt.getTime(),
      ),
    [tasks],
  )

  const taskStats = useMemo(
    () => getTaskStats(tasks),
    [tasks],
  )

  function resetForm() {
    setTitle('')
    setDescription('')
    setPriority('medium')
    setStatus('todo')
    setDueDate('')
  }

  async function handleCreateTask() {
    const trimmedTitle = title.trim()

    if (!trimmedTitle) {
      return
    }

    const now = new Date()

    try {
      const result = await run(
        'task.create',
        () => addTask({
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          title: trimmedTitle,
          description:
            description.trim() || undefined,
          status,
          priority,
          dueDate: dueDate
            ? new Date(`${dueDate}T00:00:00`)
            : undefined,
        }),
      )

      if (!result.started) {
        return
      }

      resetForm()
      setIsFormOpen(false)

      showToast({
        variant: 'success',
        title: 'Задача создана',
      })
    } catch {
      showToast({
        variant: 'error',
        title: 'Ошибка сохранения',
        message: 'Не удалось сохранить задачу.',
      })
    }
  }

  return (
    <section className="tasks-page">
      <div className="tasks-page__header">
        <div>
          <h1>Задачи</h1>

          <p>
            Управление рабочими задачами CRM
          </p>
        </div>

        <Button
          type="button"
          onClick={() =>
            setIsFormOpen((current) => !current)
          }
        >
          {isFormOpen
            ? 'Закрыть'
            : 'Новая задача'}
        </Button>
      </div>

      {isFormOpen && (
        <Modal
          open={isFormOpen}
        onClose={() => {
          if (!isPending('task.create')) {
            setIsFormOpen(false)
          }
        }}
          title="Новая задача"
          description="Создание новой рабочей задачи"
          size="lg"
        >

          <div>
            <label>
              Название
              <Input
                fullWidth
                type="text"
                value={title}
                onChange={(event) =>
                  setTitle(event.target.value)
                }
                placeholder="Введите название задачи"
              />
            </label>
          </div>

          <div>
            <label>
              Описание
              <Textarea
                fullWidth
                value={description}
                onChange={(event) =>
                  setDescription(
                    event.target.value,
                  )
                }
                placeholder="Описание задачи"
              />
            </label>
          </div>

          <div>
            <label>
              Приоритет
              <Select
                fullWidth
                value={priority}
                onChange={(event) =>
                  setPriority(
                    event.target
                      .value as TaskPriority,
                  )
                }
              >
                <option value="low">
                  Низкий
                </option>

                <option value="medium">
                  Средний
                </option>

                <option value="high">
                  Высокий
                </option>
              </Select>
            </label>
          </div>

          <div>
            <label>
              Статус
              <Select
                fullWidth
                value={status}
                onChange={(event) =>
                  setStatus(
                    event.target
                      .value as TaskStatus,
                  )
                }
              >
                <option value="todo">
                  К выполнению
                </option>

                <option value="in-progress">
                  В работе
                </option>

                <option value="completed">
                  Завершено
                </option>

                <option value="cancelled">
                  Отменено
                </option>
              </Select>
            </label>
          </div>

          <div>
            <label>
              Срок выполнения
              <Input
                fullWidth
                type="date"
                value={dueDate}
                onChange={(event) =>
                  setDueDate(
                    event.target.value,
                  )
                }
              />
            </label>
          </div>

          <div>
            <Button
              type="button"
              variant="primary"
              onClick={handleCreateTask}
              disabled={
                !title.trim() ||
                isPending('task.create')
              }
            >
              {isPending('task.create')
                ? 'Создание…'
                : 'Создать задачу'}
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!isPending('task.create')) {
                  resetForm()
                  setIsFormOpen(false)
                }
              }}
              disabled={isPending('task.create')}
            >
              Отмена
            </Button>
          </div>
        </Modal>
      )}

      {loadError && (
        <Alert
          variant="danger"
          title="Не удалось загрузить задачи"
        >
          {loadError.message}
        </Alert>
      )}

      <div className="tasks-page__summary">
        <Card className="tasks-page__card">
          <span>Всего задач</span>
          <strong>{taskStats.total}</strong>
        </Card>

        <Card className="tasks-page__card">
          <span>В работе</span>
          <strong>{taskStats.inProgress}</strong>
        </Card>

        <Card className="tasks-page__card">
          <span>Завершено</span>
          <strong>{taskStats.completed}</strong>
        </Card>
      </div>

      <Card className="tasks-page__table-wrapper">
        <Table className="tasks-page__table">
          <TableHead>
            <TableRow>
              <TableHeader>Задача</TableHeader>
              <TableHeader>Приоритет</TableHeader>
              <TableHeader>Статус</TableHeader>
              <TableHeader>Срок</TableHeader>
              <TableHeader>Действия</TableHeader>
            </TableRow>
          </TableHead>

          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5}>
                  Загрузка задач...
                </TableCell>
              </TableRow>
            ) : sortedTasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    title="Задач пока нет"
                    description="Создайте первую задачу, чтобы начать управление работой."
                  />
                </TableCell>
              </TableRow>
            ) : (
              sortedTasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <strong>
                      {task.title}
                    </strong>

                    {task.description && (
                      <p>
                        {task.description}
                      </p>
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        task.priority === 'high'
                          ? 'danger'
                          : task.priority === 'medium'
                            ? 'warning'
                            : 'success'
                      }
                    >
                      {priorityLabels[task.priority]}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <Select
                      size="sm"
                      value={task.status}
                      disabled={
                        isPending(`task.status:${task.id}`) ||
                        isPending(`task.delete:${task.id}`)
                      }
                      onChange={(event) => {
                        const nextStatus =
                          event.target.value as TaskStatus

                        void run(
                          `task.status:${task.id}`,
                          () => updateTask(
                            task.id,
                            { status: nextStatus },
                          ),
                        )
                          .then((result) => {
                          if (!result.started) {
                            return
                          }

                          showToast({
                            variant: 'info',
                            title: 'Статус задачи изменён',
                          })
                          })
                          .catch(() => {
                          showToast({
                            variant: 'error',
                            title: 'Ошибка сохранения',
                            message: 'Не удалось изменить статус задачи.',
                          })
                          })
                      }}
                    >
                      <option value="todo">
                        К выполнению
                      </option>

                      <option value="in-progress">
                        В работе
                      </option>

                      <option value="completed">
                        Завершено
                      </option>

                      <option value="cancelled">
                        Отменено
                      </option>
                    </Select>
                  </TableCell>

                  <TableCell>
                    {task.dueDate
                      ? task.dueDate.toLocaleDateString(
                        'ru-RU',
                      )
                      : '—'}
                  </TableCell>

                  <TableCell>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => setTaskToDelete(task.id)}
                      disabled={
                        isPending(`task.status:${task.id}`) ||
                        isPending(`task.delete:${task.id}`)
                      }
                    >
                      Удалить
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <ConfirmDialog
        open={taskToDelete !== null}
        onClose={() => setTaskToDelete(null)}
        title="Удаление задачи"
        description="Вы действительно хотите удалить эту задачу?"
        confirmLabel="Удалить задачу"
        cancelLabel="Назад"
        variant="danger"
        loading={
          taskToDelete !== null &&
          isPending(`task.delete:${taskToDelete}`)
        }
        onConfirm={async () => {
          if (!taskToDelete) {
            return
          }

          try {
            const result = await run(
              `task.delete:${taskToDelete}`,
              () => deleteTask(taskToDelete),
            )

            if (!result.started) {
              return
            }

            showToast({
              variant: 'warning',
              title: 'Задача удалена',
            })

            setTaskToDelete(null)
          } catch {
            showToast({
              variant: 'error',
              title: 'Ошибка сохранения',
              message: 'Не удалось удалить задачу.',
            })
          }
        }}
      />
    </section>
  )
}
