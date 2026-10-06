const paymentMethodLabels: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  transfer: 'Перевод',
  other: 'Другое',
}

const movementTypeLabels: Record<string, string> = {
  opening: 'Начальный остаток',
  sale: 'Продажа',
  return: 'Возврат',
  goods_receipt: 'Поступление',
  transfer: 'Перемещение',
  reconciliation_adjustment: 'Корректировка сверки',
}

const movementSourceTypeLabels: Record<string, string> = {
  retail_sale: 'Продажа',
  retail_sale_return: 'Возврат',
  retail_goods_receipt: 'Поступление',
  retail_transfer_dispatched: 'Отправка перемещения',
  retail_transfer_received: 'Приёмка перемещения',
  retail_store_opening: 'Начальный остаток',
  retail_offline_sale_sync: 'Оффлайн-синхронизация продажи',
  retail_offline_stock_conflict_materialization: 'Подтверждённая офлайн-операция',
}

export function retailPaymentMethodLabel(method: string): string {
  return paymentMethodLabels[method] ?? `Неизвестный способ (${method || '—'})`
}

export function retailMovementTypeLabel(type: string): string {
  return movementTypeLabels[type] ?? `Неизвестный тип движения (${type || '—'})`
}

export function retailMovementSourceLabel(sourceType: string, sourceLabel: string): string {
  return movementSourceTypeLabels[sourceType] ?? sourceLabel
}
