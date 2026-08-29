import { useEffect, useRef, useState } from 'react'
import {
  Link,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { useClients } from '../../context/useClients'
import { useTransactionalState } from '../../context/useTransactionalState'
import { getSalesHistory, type SalesHistory } from '../../shared/api/commerceApi'
import './ClientDetails.css'
import {
  Button,
  Card,
} from '@madina/ui'
export function ClientDetails() {
  const { clientId } = useParams()
  const navigate = useNavigate()

  const { clients } = useClients()
  const { snapshot } = useTransactionalState()

  const client = clients.find(
    (item) => item.id === clientId,
  )

  const [history, setHistory] = useState<SalesHistory | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const requestGeneration = useRef(0)

  function refreshHistory() {
    if (!clientId) return
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    setIsLoading(true)
    setLoadError(null)
    void getSalesHistory({ clientId, status: 'completed' })
      .then((response) => {
        if (requestGeneration.current === generation) setHistory(response)
      })
      .catch((error: unknown) => {
        if (requestGeneration.current === generation) setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить историю продаж.')
      })
      .finally(() => {
        if (requestGeneration.current === generation) setIsLoading(false)
      })
  }

  useEffect(() => { refreshHistory() }, [clientId, snapshot])

  async function loadMore() {
    const cursor = history?.sales.nextCursor
    if (!cursor || isLoading || isLoadingMore || !clientId) return
    const generation = requestGeneration.current
    setIsLoadingMore(true)
    try {
      const response = await getSalesHistory({ clientId, status: 'completed', cursor })
      if (requestGeneration.current !== generation) return
      setHistory((current) => current ? {
        ...current,
        sales: { items: [...current.sales.items, ...response.sales.items], nextCursor: response.sales.nextCursor },
      } : current)
    } catch (error) {
      if (requestGeneration.current === generation) setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить следующие продажи.')
    } finally {
      if (requestGeneration.current === generation) setIsLoadingMore(false)
    }
  }

  const clientSummary = history?.summary
  const completedSummary = clientSummary && 'completedTotalAmount' in clientSummary
    ? clientSummary
    : undefined
  const completedSales = history?.sales.items ?? []
  const totalAmount = completedSummary
    ? completedSummary.completedTotalAmount
    : 0
  const lastSaleDate = completedSummary
    ? completedSummary.lastSaleDate
    : undefined

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
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              navigate('/clients')
            }
          >
            ← Назад к клиентам
          </Button>

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

      <Card className="client-details-page__summary-card">
        <article>
          <span>Продажи</span>
          <strong>
            {completedSummary?.completedCount ?? '—'}
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
            {lastSaleDate
              ? new Date(lastSaleDate).toLocaleDateString(
                'ru-RU',
              )
              : '—'}
          </strong>
        </article>
      </Card>

      <Card
        className="client-details-page__info"
        padding="lg"
      >
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
      </Card>

      <Card className="client-details-page__sales">
        <div className="client-details-page__section-header">
          <h2>История продаж</h2>

          <span>
            {completedSummary?.completedCount ?? '—'}{' '}
            {completedSales.length === 1
              ? 'продажа'
              : 'продаж'}
          </span>
        </div>

        {isLoading ? (
          <p>Загрузка истории продаж…</p>
        ) : loadError ? (
          <p>{loadError} <Button type="button" variant="secondary" onClick={refreshHistory}>Повторить</Button></p>
        ) : completedSales.length === 0 ? (
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
        {history?.sales.nextCursor && !isLoading && (
          <div className="client-details-page__load-more"><Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={isLoadingMore}>{isLoadingMore ? 'Загрузка…' : 'Показать ещё'}</Button></div>
        )}
      </Card>
    </section>
  )
}
