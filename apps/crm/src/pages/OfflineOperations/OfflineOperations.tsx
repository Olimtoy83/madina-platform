import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, EmptyState } from '@madina/ui'
import { readLocalOfflineOperations, type LocalOperation, type LocalOperationState, type LocalOperationsProjection, type SafeResultClassification } from '../../shared/offline/offlineOperationsProjection'
import './OfflineOperations.css'

const states = {
  PREPARED: { label: 'Подготовлена локально', variant: 'warning', priority: 0, guidance: 'Подготовка продажи не завершена. Не создавайте продажу-дубликат.' },
  WAITING_FIRST_DELIVERY: { label: 'Ожидает первой отправки', variant: 'info', priority: 1, guidance: 'Продажа завершена локально и ожидает первой отправки. Не создавайте дубликат.' },
  RETRY_WAIT: { label: 'Ожидает автоматической попытки', variant: 'warning', priority: 1, guidance: 'Автоматическая попытка запланирована. Проверьте соединение и не создавайте дубликат.' },
  AUTH_HOLD: { label: 'Нужна авторизация', variant: 'warning', priority: 0, guidance: 'Восстановите авторизованную сессию для штатной обработки.' },
  ACCESS_HOLD: { label: 'Нет доступа', variant: 'warning', priority: 0, guidance: 'Проверьте доступ пользователя к торговой точке.' },
  REVIEW_HOLD: { label: 'Требуется проверка', variant: 'warning', priority: 0, guidance: 'Разберитесь в причине удержания до любых дальнейших действий.' },
  ACCEPTED: { label: 'Принята — локально наблюдавшийся исход', variant: 'success', priority: 2, guidance: 'Принятие было записано этим браузером; это не проверка текущего состояния сервера.' },
  STOCK_CONFLICT: { label: 'Конфликт остатков', variant: 'danger', priority: 0, guidance: 'Следуйте действующему процессу разбора конфликта остатков.' },
  HARD_REJECTED: { label: 'Отклонена', variant: 'danger', priority: 0, guidance: 'Передайте ответственному ID операции. Не отправляйте её повторно вручную.' },
} as const satisfies Record<LocalOperationState, { label: string; variant: 'info' | 'success' | 'warning' | 'danger'; priority: number; guidance: string }>

const results = {
  NOT_COMMITTED: 'Не завершена локально', NOT_ATTEMPTED: 'Отправка не предпринималась',
  FIRST_ACCEPTANCE: 'Первое принятие наблюдалось локально', EXACT_REPLAY: 'Точное повторное принятие наблюдалось локально',
  VERIFIED_STOCK_CONFLICT: 'Подтверждённый конфликт остатков', IDEMPOTENCY_CONFLICT: 'Конфликт идемпотентности',
  ENVELOPE_REJECTED: 'Отклонён офлайн-конверт', AUTH_REQUIRED: 'Требуется авторизация', ACCESS_DENIED: 'Доступ отклонён',
  REQUEST_TIMEOUT: 'Истекло время запроса', RATE_LIMITED: 'Ограничение частоты запросов', SERVER_FAILURE: 'Ошибка сервера',
  NO_HTTP_RESULT: 'Ответ сервера не получен', SUCCESS_RESPONSE_UNREADABLE: 'Успешный ответ не удалось проверить',
  REVIEW_REQUIRED: 'Требуется проверка', OTHER_RESPONSE: 'Другой ответ без подтверждённого исхода',
} as const satisfies Record<SafeResultClassification, string>

function localTime(value: string | number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Неизвестно' : date.toLocaleString('ru-RU')
}

function OperationCard({ operation }: { operation: LocalOperation }) {
  const presentation = states[operation.state]
  return (
    <Card className="offline-operations__operation">
      <div className="offline-operations__operation-heading">
        <h3>ID операции: <span className="offline-operations__id">{operation.operationId}</span></h3>
        <Badge variant={presentation.variant} size="sm" dot>{presentation.label}</Badge>
      </div>
      <p className="offline-operations__guidance">{presentation.guidance}</p>
      <dl className="offline-operations__details">
        <div><dt>Предложенный локальный ID продажи</dt><dd className="offline-operations__id">{operation.proposedSaleId}</dd></div>
        <div><dt>Попыток отправки</dt><dd>{operation.attemptCount}</dd></div>
        <div><dt>Локальный результат</dt><dd>{results[operation.result]}</dd></div>
        {operation.committedAt && <div><dt>Завершена локально</dt><dd>{localTime(operation.committedAt)}</dd></div>}
        {operation.lastAttemptAt !== undefined && <div><dt>Последняя попытка</dt><dd>{localTime(operation.lastAttemptAt)}</dd></div>}
        {operation.nextAttemptAt !== undefined && <div><dt>Следующая плановая попытка</dt><dd>{localTime(operation.nextAttemptAt)}</dd></div>}
        {operation.lastHttpStatus !== undefined && <div><dt>Последний HTTP-статус</dt><dd>{operation.lastHttpStatus}</dd></div>}
        {operation.clientObservedAt && <div><dt>Исход наблюдался локально</dt><dd>{localTime(operation.clientObservedAt)}</dd></div>}
      </dl>
    </Card>
  )
}

export function OfflineOperations() {
  const [observation, setObservation] = useState<LocalOperationsProjection | null>(null)
  const [loading, setLoading] = useState(true)
  const readId = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++readId.current
    setLoading(true)
    try {
      const next = await readLocalOfflineOperations()
      if (readId.current === current) setObservation(next)
    } catch {
      if (readId.current === current) setObservation({ state: 'OFFLINE_STATE_LOST' })
    } finally {
      if (readId.current === current) setLoading(false)
    }
  }, [])
  useEffect(() => { void refresh(); return () => { readId.current++ } }, [refresh])

  return (
    <section className="offline-operations">
      <header className="offline-operations__header">
        <div><h1>Офлайн-операции</h1><p>Локальная диагностика этого браузера и терминала.</p></div>
        <Button type="button" variant="secondary" onClick={() => void refresh()} disabled={loading}>Обновить локальную диагностику</Button>
      </header>
      <Alert variant="info" title="Только этот браузер">
        Это не обзор всех терминалов: отсутствие локальных проблем не доказывает их исправность. Текущее состояние сервера может отличаться, особенно без сети.
      </Alert>
      {loading || !observation ? (
        <p role="status" aria-live="polite">Читаем локальную диагностику…</p>
      ) : observation.state === 'OFFLINE_STATE_LOST' ? (
        <Alert variant="danger" title="Локальные офлайн-операции недоступны" className="offline-operations__blocking">
          Целостность или доступность локального офлайн-состояния не подтверждена. Не полагайтесь на эти данные и обратитесь к ответственному для безопасной проверки.
        </Alert>
      ) : observation.state === 'LEGACY_SCHEMA' ? (
        <Alert variant="warning" title="Поддерживаемая прежняя схема">
          В этом браузере используется локальная схема версии {observation.schemaVersion}. Полная диагностика операций недоступна; само по себе это не означает потерю данных.
        </Alert>
      ) : observation.state === 'UNINITIALIZED' ? (
        <EmptyState title="Локальное офлайн-состояние не установлено" description="В этом браузере или профиле нет локальных данных офлайн-терминала. Это не сообщение о потере данных." />
      ) : observation.state === 'KEY_GENERATED' ? (
        <Card>
          <h2>Терминал ещё не зарегистрирован</h2>
          <p>Локальный ключ создан, но терминал ещё не готов к офлайн-операциям.</p>
          {observation.pendingProvisioning && <p>Подготовка регистрации: {observation.pendingProvisioning === 'enrollment' ? 'регистрация' : 'смена ключа'}.</p>}
        </Card>
      ) : (
        <>
          <Card className="offline-operations__terminal">
            <h2>Этот локальный терминал</h2>
            <dl className="offline-operations__details">
              <div><dt>ID терминала</dt><dd className="offline-operations__id">{observation.terminalId ?? 'Не указан'}</dd></div>
              <div><dt>ID торговой точки</dt><dd className="offline-operations__id">{observation.locationId ?? 'Не указан'}</dd></div>
            </dl>
            {observation.pendingProvisioning && <p>Подготовлено действие с терминалом: {observation.pendingProvisioning === 'rotation' ? 'смена ключа' : 'регистрация'}.</p>}
          </Card>
          <div className="offline-operations__summary" aria-label="Локальная сводка операций">
            <Card><span>Подготовлены</span><strong>{observation.preparedCount}</strong></Card>
            <Card><span>Ожидают обработки</span><strong>{observation.pendingCount}</strong></Card>
            <Card><span>Ожидают повтора</span><strong>{observation.retryCount}</strong></Card>
            <Card><span>Требуют внимания</span><strong>{observation.attentionCount}</strong></Card>
          </div>
          <p className="offline-operations__count-note">Категории могут пересекаться: например, ожидающие повтора входят в ожидающие обработки.</p>
          {observation.lastLocallyObservedAcceptance && <p className="offline-operations__last-accepted">Последнее локально наблюдавшееся принятие: <span className="offline-operations__id">{observation.lastLocallyObservedAcceptance.operationId}</span> — {localTime(observation.lastLocallyObservedAcceptance.clientObservedAt)}.</p>}
          <section className="offline-operations__list" aria-label="Локальные операции">
            <h2>Операции этого браузера</h2>
            {observation.operations.length === 0 ? (
              <EmptyState title="Локальных операций пока нет" description="В этом профиле нет подготовленных или завершённых локально офлайн-продаж." />
            ) : (
              <div className="offline-operations__cards">
                {[...observation.operations].sort((a, b) => states[a.state].priority - states[b.state].priority).map(operation => <OperationCard key={operation.operationId} operation={operation} />)}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}
