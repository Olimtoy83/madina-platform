import { useMemo, useState } from 'react'
import { useTasks } from '../../context/useTasks'
import type {
  TaskPriority,
  TaskStatus,
} from '@madina/core'
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

        <button
          type="button"
          onClick={() =>
            setIsFormOpen((current) => !current)
          }
        >
          {isFormOpen
            ? 'Закрыть'
            : 'Новая задача'}
        </button>
      </div>

      {isFormOpen && (
        <section className="tasks-page__form">
          <h2>Новая задача</h2>

          <div>
            <label>
              Название
              <input
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
              <textarea
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
              <select
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
              </select>
            </label>
          </div>

          <div>
            <label>
              Статус
              <select
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
              </select>
            </label>
          </div>

          <div>
            <label>
              Срок выполнения
              <input
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
            <button
              type="button"
              className="btn-primary"
              onClick={handleCreateTask}
              disabled={!title.trim()}
            >
              Создать задачу
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                resetForm()
                setIsFormOpen(false)
              }}
            >
              Отмена
            </button>
          </div>
        </section>
      )}

      <div className="tasks-page__summary">
        <article className="tasks-page__card">
          <span>Всего задач</span>
          <strong>{tasks.length}</strong>
        </article>

        <article className="tasks-page__card">
          <span>В работе</span>
          <strong>
            {
              tasks.filter(
                (task) =>
                  task.status === 'in-progress',
              ).length
            }
          </strong>
        </article>

        <article className="tasks-page__card">
          <span>Завершено</span>
          <strong>
            {
              tasks.filter(
                (task) =>
                  task.status === 'completed',
              ).length
            }
          </strong>
        </article>
      </div>

      <div className="tasks-page__table-wrapper">
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
                    {priorityLabels[task.priority]}
                  </td>

                  <td>
                    <select
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
                    </select>
                  </td>

                  <td>
                    {task.dueDate
                      ? task.dueDate.toLocaleDateString(
                        'ru-RU',
                      )
                      : '—'}
                  </td>

                  <td>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() =>
                        deleteTask(task.id)
                      }
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
