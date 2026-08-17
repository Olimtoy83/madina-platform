import { useMemo } from 'react'
import {
  Link,
  useNavigate,
  useParams,
} from 'react-router-dom'
import {
  getClientSalesStats,
  getCompletedSalesForClient,
} from '@madina/core'
import { useClients } from '../../context/useClients'
import { useSales } from '../../context/useSales'
import './ClientDetails.css'
import { Button } from '@madina/ui'
export function ClientDetails() {
  const { clientId } = useParams()
  const navigate = useNavigate()

  const { clients } = useClients()
  const { sales } = useSales()

  const client = clients.find(
    (item) => item.id === clientId,
  )

  const completedSales = useMemo(
    () =>
      client
        ? getCompletedSalesForClient(
          client,
          sales,
        )
        : [],
    [sales, client],
  )

  const clientStats = useMemo(
    () =>
      client
        ? getClientSalesStats(
          client,
          sales,
        )
        : {
          salesCount: 0,
          totalAmount: 0,
          lastSaleDate: undefined,
        },
    [client, sales],
  )

  const totalAmount =
    clientStats.totalAmount

  const lastSale =
    completedSales[0]

  if (!client) {
    return (
      <section className="client-details-page">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            navigate('/clients')
          }
        >
          ← Назад к клиентам
        </Button>

        <h1>Клиент не найден</h1>

        <p>
          Клиент с указанным идентификатором
          отсутствует.
        </p>
      </section>
    )
  }

  return (
    <section className="client-details-page">
      <div className="client-details-page__header">
        <div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              navigate('/clients')
            }
          >
            ← Назад к клиентам
          </button>

          <Button
            type="button"
            variant="primary"
            onClick={() =>
              navigate(
                `/sales?clientId=${encodeURIComponent(
                  client.id,
                )}`,
              )
            }
          >
            Новая продажа
          </Button>

          <h1>{client.name}</h1>

          <p>Карточка клиента CRM</p>
        </div>
      </div>

      <div className="client-details-page__summary">
        <article>
          <span>Продажи</span>
          <strong>
            {clientStats.salesCount}
          </strong>
        </article>

        <article>
          <span>Общая сумма</span>
          <strong>
            {totalAmount.toLocaleString(
              'ru-RU',
            )}{' '}
            SAR
          </strong>
        </article>

        <article>
          <span>Последняя покупка</span>
          <strong>
            {lastSale
              ? lastSale.saleDate.toLocaleDateString(
                'ru-RU',
              )
              : '—'}
          </strong>
        </article>
      </div>

      <section className="client-details-page__info">
        <h2>Информация о клиенте</h2>

        <div>
          <span>Телефон</span>
          <strong>
            {client.phone ?? '—'}
          </strong>
        </div>

        <div>
          <span>Email</span>
          <strong>
            {client.email ?? '—'}
          </strong>
        </div>

        <div>
          <span>Компания</span>
          <strong>
            {client.company ?? '—'}
          </strong>
        </div>

        <div>
          <span>Статус</span>
          <strong>
            {client.status === 'active'
              ? 'Активен'
              : 'Неактивен'}
          </strong>
        </div>

        <div>
          <span>Примечание</span>
          <strong>
            {client.note ?? '—'}
          </strong>
        </div>
      </section>

      <section className="client-details-page__sales">
        <div className="client-details-page__section-header">
          <h2>История продаж</h2>

          <span>
            {completedSales.length}{' '}
            {completedSales.length === 1
              ? 'продажа'
              : 'продаж'}
          </span>
        </div>

        {completedSales.length === 0 ? (
          <p>
            Завершённых продаж пока нет.
          </p>
        ) : (
          <div>
            {completedSales.map(
              (sale) => (
                <div
                  key={sale.id}
                  className="client-details-page__sale-row"
                >
                  <div>
                    <Link
                      to={`/sales/${sale.id}`}
                    >
                      {sale.saleNumber}
                    </Link>

                    <p>
                      {sale.saleDate.toLocaleDateString(
                        'ru-RU',
                      )}
                    </p>
                  </div>

                  <strong>
                    {sale.totalAmount.toLocaleString(
                      'ru-RU',
                    )}{' '}
                    SAR
                  </strong>
                </div>
              ),
            )}
          </div>
        )}
      </section>
    </section>
  )
}
