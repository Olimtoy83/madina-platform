import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useClients } from '../../context/useClients'
import { useSales } from '../../context/useSales'
import type {
  ClientStatus,
} from '../../entities/client'

export function Clients() {
  const {
    clients,
    addClient,
    updateClient,
    deleteClient,
  } = useClients()

  const { sales } = useSales()

  const [isFormOpen, setIsFormOpen] =
    useState(false)

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
        const completedSales = sales.filter(
          (sale) =>
            sale.status === 'completed' &&
            (
              sale.clientId === client.id ||
              (
                !sale.clientId &&
                sale.clientName.trim().toLowerCase() ===
                client.name.trim().toLowerCase()
              )
            ),
        )

        const totalAmount = completedSales.reduce(
          (sum, sale) =>
            sum + sale.totalAmount,
          0,
        )

        const lastSale = completedSales.reduce<
          (typeof completedSales)[number] | undefined
        >(
          (latest, sale) =>
            !latest ||
              sale.saleDate.getTime() >
              latest.saleDate.getTime()
              ? sale
              : latest,
          undefined,
        )

        stats[client.id] = {
          salesCount: completedSales.length,
          totalAmount,
          lastSaleDate:
            lastSale?.saleDate,
        }

        return stats
      },
      {} as Record<
        string,
        {
          salesCount: number
          totalAmount: number
          lastSaleDate?: Date
        }
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

        <button
          type="button"
          onClick={() =>
            setIsFormOpen((current) => !current)
          }
        >
          {isFormOpen
            ? 'Закрыть'
            : 'Новый клиент'}
        </button>
      </div>

      {isFormOpen && (
        <section className="clients-page__form">
          <h2>Новый клиент</h2>

          <label>
            Имя
            <input
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
            <input
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
            <input
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
            <input
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
            <textarea
              value={note}
              onChange={(event) =>
                setNote(event.target.value)
              }
              placeholder="Дополнительная информация"
            />
          </label>

          <label>
            Статус
            <select
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
            </select>
          </label>

          <div className="clients-page__form-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleCreateClient}
              disabled={!name.trim()}
            >
              Создать клиента
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

      <div className="clients-page__summary">
        <article>
          <span>Всего клиентов</span>
          <strong>{clients.length}</strong>
        </article>

        <article>
          <span>Активные</span>
          <strong>
            {
              clients.filter(
                (client) =>
                  client.status === 'active',
              ).length
            }
          </strong>
        </article>
      </div>

      <div className="clients-page__table-wrapper">
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
                      <select
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
                      </select>
                    </td>

                    <td>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() =>
                          deleteClient(client.id)
                        }
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div >
    </section >
  )
}

