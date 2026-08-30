import './Clients.css'
import { Link } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useClients } from '../../context/useClients'
import { useTransactionalState } from '../../context/useTransactionalState'
import { usePermissions } from '../../context/usePermissions'
import { useToast } from '../../context/ToastProvider'
import { usePendingCommand } from '../../shared/usePendingCommand'
import {
  createClient,
  type ClientStatus,
} from '@madina/core'
import { getClientSalesMetrics } from '../../shared/api/commerceApi'
import {
  Button,
  Card,
  Alert,
  Input,
  Modal,
  Textarea,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  EmptyState,
  FormField,
  Spinner,
} from '@madina/ui'

export function Clients() {
  const {
    clients,
    isLoading,
    loadError,
    reload,
    addClient,
    updateClient,
    deactivateClient,
  } = useClients()

  const { snapshot } = useTransactionalState()
  const { can } = usePermissions()
  const canWriteClients = can('clients:write')

  const { showToast } = useToast()
  const { isPending, run } = usePendingCommand()

  const [isFormOpen, setIsFormOpen] =
    useState(false)

  const [clientToDeactivate, setClientToDeactivate] =
    useState<string | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [note, setNote] = useState('')
  const [clientStats, setClientStats] = useState<Record<string, {
    salesCount: number
    totalAmount: number
    lastSaleDate?: Date
  }> | null>(null)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const metricsGeneration = useRef(0)
  const [status, setStatus] =
    useState<ClientStatus>('active')

  const sortedClients = useMemo(
    () =>
      [...clients].sort(
        (a, b) =>
          b.createdAt.getTime() -
          a.createdAt.getTime(),
      ),
    [clients],
  )

  function resetForm() {
    setName('')
    setPhone('')
    setEmail('')
    setCompany('')
    setNote('')
    setStatus('active')
  }

  async function handleCreateClient() {
    const trimmedName = name.trim()

    if (!trimmedName) {
      return
    }

    try {
      const client = createClient({
        name,
        phone,
        email,
        company,
        note,
        status,
      })

      const command = await run(
        'client.create',
        () => addClient(client),
      )

      if (!command.started) {
        return
      }

      showToast({
        variant: 'success',
        title: 'Клиент добавлен',
        message: client.name,
      })

      resetForm()
      setIsFormOpen(false)
    } catch {
      showToast({
        variant: 'error',
        title: 'Ошибка сохранения',
        message: 'Не удалось сохранить клиента.',
      })
    }
  }

  useEffect(() => {
    const generation = metricsGeneration.current + 1
    metricsGeneration.current = generation
    if (clients.length === 0) {
      setClientStats({})
      setMetricsError(null)
      return
    }
    setClientStats(null)
    setMetricsError(null)
    void getClientSalesMetrics(clients.map((client) => client.id))
      .then((response) => {
        if (metricsGeneration.current !== generation) return
        setClientStats(Object.fromEntries(response.metrics.map((metric) => [metric.clientId, {
          salesCount: metric.completedCount,
          totalAmount: metric.completedTotalAmount,
          lastSaleDate: metric.lastSaleDate ? new Date(metric.lastSaleDate) : undefined,
        }])))
      })
      .catch((error: unknown) => {
        if (metricsGeneration.current !== generation) return
        setMetricsError(error instanceof Error ? error.message : 'Не удалось загрузить показатели продаж.')
      })
  }, [clients, snapshot])

  return (
    <section className="clients-page">
      <div className="clients-page__header">
        <div>
          <h1>Клиенты</h1>

          <p>
            Управление клиентами CRM
          </p>
        </div>

        {canWriteClients && (
        <Button
          type="button"
          variant="primary"
          onClick={() =>
            setIsFormOpen((current) => !current)
          }
        >
          {isFormOpen
            ? 'Закрыть'
            : 'Новый клиент'}
        </Button>
        )}
      </div>

      {canWriteClients && (
      <Modal
        open={isFormOpen}
        onClose={() => {
          if (!isPending('client.create')) {
            resetForm()
            setIsFormOpen(false)
          }
        }}
        title="Новый клиент"
        description="Создание нового клиента"
        size="md"
      >
        <h2>Новый клиент</h2>

        <FormField
          label="Имя"
          htmlFor="client-name"
          required
        >
          <Input
            id="client-name"
            type="text"
            value={name}
            onChange={(event) =>
              setName(event.target.value)
            }
            placeholder="Введите имя клиента"
          />
        </FormField>

        <FormField label="Телефон" htmlFor="client-phone">
          <Input
            id="client-phone"
            type="text"
            value={phone}
            onChange={(event) =>
              setPhone(event.target.value)
            }
            placeholder="+966..."
          />
        </FormField>

        <FormField label="Email" htmlFor="client-email">
          <Input
            id="client-email"
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            placeholder="example@email.com"
          />
        </FormField>

        <FormField label="Компания" htmlFor="client-company">
          <Input
            id="client-company"
            type="text"
            value={company}
            onChange={(event) =>
              setCompany(event.target.value)
            }
            placeholder="Название компании"
          />
        </FormField>

        <FormField label="Примечание" htmlFor="client-note">
          <Textarea
            id="client-note"
            value={note}
            onChange={(event) =>
              setNote(event.target.value)
            }
            placeholder="Дополнительная информация"
          />
        </FormField>

        <FormField label="Статус" htmlFor="client-status">
          <Select
            id="client-status"
            value={status}
            onChange={(event) =>
              setStatus(
                event.target.value as ClientStatus,
              )
            }
          >
            <option value="active">
              Активен
            </option>
            <option value="inactive">
              Неактивен
            </option>
          </Select>
        </FormField>

        <div className="clients-page__form-actions">
          <Button
            type="button"
            variant="primary"
            onClick={handleCreateClient}
            disabled={
              !name.trim() ||
              isPending('client.create')
            }
          >
            {isPending('client.create')
              ? 'Создание…'
              : 'Создать клиента'}
          </Button>

          <Button
            type="button"
            variant="secondary"
              onClick={() => {
                if (!isPending('client.create')) {
                  resetForm()
                  setIsFormOpen(false)
                }
              }}
              disabled={isPending('client.create')}
          >
            Отмена
          </Button>
        </div>
      </Modal>
      )}

      <div className="clients-page__summary">
        <Card className="clients-page__summary-card">
          <span>Всего клиентов</span>

          <strong>
            {isLoading ? '—' : clients.length}
          </strong>
        </Card>

        <Card className="clients-page__summary-card">
          <span>Активные</span>

          <strong>
            {
              isLoading
                ? '—'
                : clients.filter(
                (client) =>
                  client.status === 'active',
              ).length
            }
          </strong>
        </Card>
      </div>

      <Card className="clients-page__table-wrapper">
        {loadError && (
          <Alert
            variant="danger"
            title="Не удалось загрузить клиентов"
          >
            <p>{loadError.message}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void reload()}
            >
              Повторить
            </Button>
          </Alert>
        )}
        {metricsError && (
          <p className="clients-page__metrics-error">
            Показатели продаж не загружены: {metricsError}
          </p>
        )}
        <Table className="clients-page__table">
          <TableHead>
            <TableRow>
              <TableHeader>Клиент</TableHeader>
              <TableHeader>Телефон</TableHeader>
              <TableHeader>Email</TableHeader>
              <TableHeader>Компания</TableHeader>
              <TableHeader>Продажи</TableHeader>
              <TableHeader>Сумма</TableHeader>
              <TableHeader>Последняя покупка</TableHeader>
              <TableHeader>Статус</TableHeader>
              <TableHeader>Действия</TableHeader>
            </TableRow>
          </TableHead>

          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9}>
                  <Spinner /> Загрузка клиентов…
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={9}>
                  Клиенты пока недоступны. Повторите загрузку.
                </TableCell>
              </TableRow>
            ) : sortedClients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9}>
                  <EmptyState
                    title="Клиентов пока нет"
                    description="Добавьте первого клиента, чтобы начать работу с CRM."
                  />
                </TableCell>
              </TableRow>
            ) : (
              sortedClients.map((client) => {
                const stats = clientStats?.[client.id]

                return (
                  <TableRow key={client.id}>
                    <TableCell>
                      <strong>
                        <Link to={`/clients/${client.id}`}>
                          {client.name}
                        </Link>
                      </strong>

                      {client.note && (
                        <p>{client.note}</p>
                      )}
                    </TableCell>

                    <TableCell>
                      {client.phone ?? '—'}
                    </TableCell>

                    <TableCell>
                      {client.email ?? '—'}
                    </TableCell>

                    <TableCell>
                      {client.company ?? '—'}
                    </TableCell>

                    <TableCell>
                      {stats ? stats.salesCount : '—'}
                    </TableCell>

                    <TableCell>
                      {stats
                        ? `${stats.totalAmount.toLocaleString('ru-RU')} SAR`
                        : '—'}
                    </TableCell>

                    <TableCell>
                      {stats?.lastSaleDate
                        ? stats.lastSaleDate.toLocaleDateString(
                          'ru-RU',
                        )
                        : '—'}
                    </TableCell>

                    <TableCell>
                      {canWriteClients ? (
                      <Select
                        size="sm"
                        value={client.status}
                        disabled={
                          isPending(`client.status:${client.id}`) ||
                          isPending(`client.deactivate:${client.id}`)
                        }
                        onChange={async (event) => {
                          try {
                            const command = await run(
                              `client.status:${client.id}`,
                              () => updateClient(
                                client.id,
                                {
                                  status:
                                    event.target.value as ClientStatus,
                                },
                              ),
                            )

                            if (!command.started) {
                              return
                            }

                            showToast({
                              variant: 'success',
                              title: 'Статус клиента изменён',
                              message: client.name,
                            })
                          } catch {
                            showToast({
                              variant: 'error',
                              title: 'Ошибка сохранения',
                              message: 'Не удалось изменить статус клиента.',
                            })
                          }
                        }}
                      >
                        <option value="active">
                          Активен
                        </option>

                        <option value="inactive">
                          Неактивен
                        </option>
                      </Select>
                      ) : (
                        client.status === 'active'
                          ? 'Активен'
                          : 'Неактивен'
                      )}
                    </TableCell>

                    <TableCell>
                      {canWriteClients && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                        setClientToDeactivate(client.id)
                        }}
                        disabled={
                          isPending(`client.status:${client.id}`) ||
                          isPending(`client.deactivate:${client.id}`)
                        }
                      >
                        Деактивировать
                      </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {canWriteClients && clientToDeactivate && (
        <Modal
          open={true}
          onClose={() => setClientToDeactivate(null)}
          title="Деактивация клиента"
          description="Вы действительно хотите деактивировать этого клиента?"
          size="sm"
        >
          <div className="clients-page__form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setClientToDeactivate(null)}
              disabled={isPending(`client.deactivate:${clientToDeactivate}`)}
            >
              Назад
            </Button>

            <Button
              type="button"
              variant="danger"
              onClick={async () => {
                try {
                  const command = await run(
                    `client.deactivate:${clientToDeactivate}`,
                    () => deactivateClient(clientToDeactivate),
                  )

                  if (!command.started) {
                    return
                  }

                  showToast({
                    variant: 'success',
                    title: 'Клиент деактивирован',
                  })

                  setClientToDeactivate(null)
                } catch {
                  showToast({
                    variant: 'error',
                    title: 'Ошибка сохранения',
                    message: 'Не удалось деактивировать клиента.',
                  })
                }
              }}
              disabled={isPending(`client.deactivate:${clientToDeactivate}`)}
            >
              {isPending(`client.deactivate:${clientToDeactivate}`)
                ? 'Деактивация…'
                : 'Деактивировать'}
            </Button>
          </div>
        </Modal>
      )}

    </section>
  )
}
