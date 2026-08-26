import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  createTask,
  deleteTask,
  getTasks,
  updateTask,
} from './tasksApi'

function installFetch(
  responseBody: unknown,
  status = 200,
) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(
      responseBody === undefined
        ? undefined
        : JSON.stringify(responseBody),
      {
        status,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )),
  )

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tasksApi', () => {
  it('gets the tasks list', async () => {
    const fetchMock = installFetch({
      tasks: [{
        id: 'task-1',
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
        title: 'Позвонить клиенту',
        status: 'todo',
        priority: 'medium',
      }],
    })

    await expect(getTasks()).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/tasks',
      expect.any(Object),
    )
  })

  it('creates and updates a task', async () => {
    const fetchMock = installFetch({
      id: 'task-1',
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
      title: 'Позвонить клиенту',
      status: 'todo',
      priority: 'medium',
    }, 201)

    await createTask({
      title: 'Позвонить клиенту',
      status: 'todo',
      priority: 'medium',
    })

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        title: 'Позвонить клиенту',
        status: 'todo',
        priority: 'medium',
      }),
    })

    await updateTask('task/1', { status: 'completed' })

    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/v1/tasks/task%2F1',
    )
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    })
  })

  it('deletes a task without parsing an empty response', async () => {
    const fetchMock = installFetch(undefined, 204)

    await expect(deleteTask('task-1')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'DELETE',
    })
  })
})
