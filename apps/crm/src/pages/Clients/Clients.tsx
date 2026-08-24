import './Clients.css'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useClients } from '../../context/useClients'
import { useSales } from '../../context/useSales'
import {
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
} from '@madina/ui'

export function Clients() {
  const {
    clients,
    addClient,
    updateClient,
    deactivateClient,
  } = useClients()

  const { sales } = useSales()

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

    const now = new Date()

    addClient({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      name: trimmedName,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      company:
        company.trim() || undefined,
      note: note.trim() || undefined,
      status,
    })

    resetForm()
    setIsFormOpen(false)
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
        <table className="clients-page__table">
          <thead>
            <tr>
              <th>Клиент</th>
              <th>Телефон</th>
              <th>Email</th>
              <th>Компания</th>
              <th>Продажи</th>
              <th>Сумма</th>
              <th>Последняя покупка</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>

          <tbody>
            {sortedClients.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="clients-page__empty"
                >
                  Клиентов пока нет
                </td>
              </tr>
            ) : (
              sortedClients.map((client) => {
                const stats = clientStats[client.id]

                return (
                  <tr key={client.id}>
                    <td>
                      <strong>
                        <Link to={`/clients/${client.id}`}>
                          {client.name}
                        </Link>
                      </strong>

                      {client.note && (
                        <p>{client.note}</p>
                      )}
                    </td>

                    <td>
                      {client.phone ?? '—'}
                    </td>

                    <td>
                      {client.email ?? '—'}
                    </td>

                    <td>
                      {client.company ?? '—'}
                    </td>

                    <td>
                      {stats?.salesCount ?? 0}
                    </td>

                    <td>
                      {(stats?.totalAmount ?? 0).toLocaleString(
                        'ru-RU',
                      )}{' '}
                      SAR
                    </td>

                    <td>
                      {stats?.lastSaleDate
                        ? stats.lastSaleDate.toLocaleDateString(
                          'ru-RU',
                        )
                        : '—'}
                    </td>

                    <td>
                      <Select
                        size="sm"
                        value={client.status}
                        onChange={(event) =>
                          updateClient(
                            client.id,
                            {
                              status:
                                event.target.value as ClientStatus,
                            },
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
                    </td>

                    <td>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setClientToDeactivate(client.id)
                        }}
                      >
                        Деактивировать
                      </Button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
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
                deactivateClient(clientToDeactivate)
                setClientToDeactivate(null)
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
