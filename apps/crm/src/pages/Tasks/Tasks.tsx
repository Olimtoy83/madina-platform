import { useMemo, useState } from 'react'
import { useTasks } from '../../context/useTasks'
import {
  getTaskStats,
  type TaskPriority,
  type TaskStatus,
} from '@madina/core'
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Select,
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
    addTask,
    updateTask,
    deleteTask,
  } = useTasks()

  const [isFormOpen, setIsFormOpen] =
    useState(false)

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

  function handleCreateTask() {
    const trimmedTitle = title.trim()

    if (!trimmedTitle) {
      return
    }

    const now = new Date()

    addTask({
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
    })

    resetForm()
    setIsFormOpen(false)
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
          onClose={() => setIsFormOpen(false)}
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
              disabled={!title.trim()}
            >
              Создать задачу
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                resetForm()
                setIsFormOpen(false)
              }}
            >
              Отмена
            </Button>
          </div>
        </Modal>
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
        <table className="tasks-page__table">
          <thead>
            <tr>
              <th>Задача</th>
              <th>Приоритет</th>
              <th>Статус</th>
              <th>Срок</th>
              <th>Действия</th>
            </tr>
          </thead>

          <tbody>
            {sortedTasks.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="tasks-page__empty"
                >
                  Задач пока нет
                </td>
              </tr>
            ) : (
              sortedTasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <strong>{task.title}</strong>

                    {task.description && (
                      <p>
                        {task.description}
                      </p>
                    )}
                  </td>

                  <td>
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
                  </td>

                  <td>
                    <Select
                      size="sm"
                      value={task.status}
                      onChange={(event) =>
                        updateTask(
                          task.id,
                          {
                            status:
                              event.target
                                .value as TaskStatus,
                          },
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
                  </td>

                  <td>
                    {task.dueDate
                      ? task.dueDate.toLocaleDateString(
                        'ru-RU',
                      )
                      : '—'}
                  </td>

                  <td>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() =>
                        deleteTask(task.id)
                      }
                    >
                      Удалить
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </section>
  )
}
