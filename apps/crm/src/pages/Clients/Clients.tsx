import './Clients.css'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useClients } from '../../context/useClients'
import { useSales } from '../../context/useSales'
import { useToast } from '../../context/ToastProvider'
import {
  createClient,
  getClientSalesStats,
  type ClientStatus,
} from '@madina/core'
import {
  Button,
  Card,
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
} from '@madina/ui'

export function Clients() {
  const {
    clients,
    addClient,
    updateClient,
    deactivateClient,
  } = useClients()

  const { sales } = useSales()

  const { showToast } = useToast()

  const [isFormOpen, setIsFormOpen] =
    useState(false)

  const [clientToDeactivate, setClientToDeactivate] =
    useState<string | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [note, setNote] = useState('')
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

  function handleCreateClient() {
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

      addClient(client)

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

  const clientStats = useMemo(() => {
    return clients.reduce(
      (stats, client) => {
        stats[client.id] =
          getClientSalesStats(
            client,
            sales,
          )

        return stats
      },
      {} as Record<
        string,
        ReturnType<typeof getClientSalesStats>
      >,
    )
  }, [clients, sales])

  return (
    <section className="clients-page">
      <div className="clients-page__header">
        <div>
          <h1>Клиенты</h1>

          <p>
            Управление клиентами CRM
          </p>
        </div>

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
      </div>

      <Modal
        open={isFormOpen}
        onClose={() => {
          resetForm()
          setIsFormOpen(false)
        }}
        title="Новый клиент"
        description="Создание нового клиента"
        size="md"
      >
        <h2>Новый клиент</h2>

        <label>
          Имя
          <Input
            type="text"
            value={name}
            onChange={(event) =>
              setName(event.target.value)
            }
            placeholder="Введите имя клиента"
          />
        </label>

        <label>
          Телефон
          <Input
            type="text"
            value={phone}
            onChange={(event) =>
              setPhone(event.target.value)
            }
            placeholder="+966..."
          />
        </label>

        <label>
          Email
          <Input
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            placeholder="example@email.com"
          />
        </label>

        <label>
          Компания
          <Input
            type="text"
            value={company}
            onChange={(event) =>
              setCompany(event.target.value)
            }
            placeholder="Название компании"
          />
        </label>

        <label>
          Примечание
          <Textarea
            value={note}
            onChange={(event) =>
              setNote(event.target.value)
            }
            placeholder="Дополнительная информация"
          />
        </label>

        <label>
          Статус
          <Select
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
        </label>

        <div className="clients-page__form-actions">
          <Button
            type="button"
            variant="primary"
            onClick={handleCreateClient}
            disabled={!name.trim()}
          >
            Создать клиента
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

      <div className="clients-page__summary">
        <Card className="clients-page__summary-card">
          <span>Всего клиентов</span>

          <strong>
            {clients.length}
          </strong>
        </Card>

        <Card className="clients-page__summary-card">
          <span>Активные</span>

          <strong>
            {
              clients.filter(
                (client) =>
                  client.status === 'active',
              ).length
            }
          </strong>
        </Card>
      </div>

      <Card className="clients-page__table-wrapper">
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
            {sortedClients.length === 0 ? (
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
                const stats = clientStats[client.id]

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
                      {stats?.salesCount ?? 0}
                    </TableCell>

                    <TableCell>
                      {(stats?.totalAmount ?? 0).toLocaleString(
                        'ru-RU',
                      )}{' '}
                      SAR
                    </TableCell>

                    <TableCell>
                      {stats?.lastSaleDate
                        ? stats.lastSaleDate.toLocaleDateString(
                          'ru-RU',
                        )
                        : '—'}
                    </TableCell>

                    <TableCell>
                      <Select
                        size="sm"
                        value={client.status}
                        onChange={(event) => {
                          try {
                            updateClient(
                              client.id,
                              {
                                status:
                                  event.target.value as ClientStatus,
                              },
                            )

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
                    </TableCell>

                    <TableCell>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setClientToDeactivate(client.id)
                        }}
                      >
                        Деактивировать
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {clientToDeactivate && (
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
            >
              Назад
            </Button>

            <Button
              type="button"
              variant="danger"
              onClick={() => {
                try {
                  deactivateClient(clientToDeactivate)

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
            >
              Деактивировать
            </Button>
          </div>
        </Modal>
      )}

    </section>
  )
}