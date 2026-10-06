import { expect, it } from 'vitest'
import { retailMovementSourceLabel, retailMovementTypeLabel, retailPaymentMethodLabel } from './presentation'

it.each([
  ['cash', 'Наличные'],
  ['card', 'Карта'],
  ['transfer', 'Перевод'],
  ['other', 'Другое'],
])('localizes payment method %s', (value, label) => {
  expect(retailPaymentMethodLabel(value)).toBe(label)
})

it('keeps an unknown payment method visible', () => {
  expect(retailPaymentMethodLabel('voucher')).toBe('Неизвестный способ (voucher)')
})

it.each([
  ['opening', 'Начальный остаток'],
  ['sale', 'Продажа'],
  ['return', 'Возврат'],
  ['goods_receipt', 'Поступление'],
  ['transfer', 'Перемещение'],
  ['reconciliation_adjustment', 'Корректировка сверки'],
])('localizes movement type %s', (value, label) => {
  expect(retailMovementTypeLabel(value)).toBe(label)
})

it('keeps an unknown movement type visible', () => {
  expect(retailMovementTypeLabel('future_type')).toBe('Неизвестный тип движения (future_type)')
})

it.each([
  ['retail_sale', 'Продажа'],
  ['retail_sale_return', 'Возврат'],
  ['retail_goods_receipt', 'Поступление'],
  ['retail_transfer_dispatched', 'Отправка перемещения'],
  ['retail_transfer_received', 'Приёмка перемещения'],
  ['retail_store_opening', 'Начальный остаток'],
  ['retail_offline_sale_sync', 'Оффлайн-синхронизация продажи'],
  ['retail_offline_stock_conflict_materialization', 'Подтверждённая офлайн-операция'],
])('localizes known movement source %s', (value, label) => {
  expect(retailMovementSourceLabel(value, 'English source')).toBe(label)
})

it('uses the factual source label for an unknown movement source', () => {
  expect(retailMovementSourceLabel('future_source', 'Future source')).toBe('Future source')
})
