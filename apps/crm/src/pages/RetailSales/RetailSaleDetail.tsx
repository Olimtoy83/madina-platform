import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Alert, Card, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@madina/ui'
import { useAuth } from '../../context/useAuth'
import { canRetail } from '../../shared/auth/retailPermissions'
import { getRetailCompletedSale, type RetailCompletedSale } from '../../shared/api/retailApi'
import { retailSaleReturnPath } from './retailSalesLinks'

function money(value: number, currency: string, exponent: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(value / 10 ** exponent)
}

export function RetailSaleDetail() {
  const { saleId } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const locationId = searchParams.get('locationId') ?? ''
  const [sale, setSale] = useState<RetailCompletedSale>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)

  useEffect(() => {
    if (!saleId || !locationId) { setError('Для просмотра продажи требуется торговая точка.'); setLoading(false); return }
    const current = generation.current + 1
    generation.current = current
    setLoading(true); setError(undefined)
    void getRetailCompletedSale(locationId, saleId).then(value => {
      if (generation.current === current) setSale(value)
    }).catch((reason: unknown) => {
      if (generation.current === current) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить продажу.')
    }).finally(() => { if (generation.current === current) setLoading(false) })
  }, [locationId, saleId])

  if (loading) return <section><p>Загрузка продажи…</p></section>
  if (!sale || error) return <section><Link to="/retail/sales">← К журналу продаж</Link><EmptyState title="Продажа недоступна" description={error ?? 'Продажа не найдена.'} /></section>
  const hasReturnableItems = sale.items.some(item => item.already_returned_quantity < item.quantity)
  const canReturn = canRetail(user, 'retail:sales:return') && hasReturnableItems
  return <section>
    <Link to="/retail/sales">← К журналу продаж</Link>
    <header><h1>Розничная продажа</h1><p>{sale.sale.id}</p></header>
    <Card><p><strong>Торговая точка:</strong> {sale.sale.location_name}{sale.sale.location_code ? ` (${sale.sale.location_code})` : ''}</p><p><strong>Завершена:</strong> {new Date(sale.sale.completed_at).toLocaleString('ru-RU')}</p><p><strong>Итого:</strong> {money(sale.sale.payable_total_minor, sale.sale.currency_code, sale.sale.currency_exponent)}</p>{canReturn && <Link to={retailSaleReturnPath(locationId, sale.sale.id)}>Оформить возврат</Link>}{!canReturn && !hasReturnableItems && <Alert variant="info" title="Возврат недоступен">Все позиции этой продажи уже возвращены.</Alert>}</Card>
    <Card><h2>Позиции</h2><Table><TableHead><TableRow><TableHeader>Товар</TableHeader><TableHeader>Количество</TableHeader><TableHeader>Цена</TableHeader><TableHeader>Сумма</TableHeader><TableHeader>Возвращено</TableHeader></TableRow></TableHead><TableBody>{sale.items.map(item => <TableRow key={item.sale_item_id}><TableCell>{item.name} ({item.source_id})</TableCell><TableCell>{item.quantity}</TableCell><TableCell>{money(item.unit_price_minor, sale.sale.currency_code, sale.sale.currency_exponent)}</TableCell><TableCell>{money(item.line_total_minor - item.discount_amount_minor, sale.sale.currency_code, sale.sale.currency_exponent)}</TableCell><TableCell>{item.already_returned_quantity}</TableCell></TableRow>)}</TableBody></Table></Card>
    <Card><h2>Оплаты</h2><Table><TableHead><TableRow><TableHeader>Способ</TableHeader><TableHeader>Сумма</TableHeader><TableHeader>Возвращено</TableHeader></TableRow></TableHead><TableBody>{sale.paymentAllocations.map(payment => <TableRow key={payment.id}><TableCell>{payment.method}</TableCell><TableCell>{money(payment.amount_minor, sale.sale.currency_code, sale.sale.currency_exponent)}</TableCell><TableCell>{money(payment.already_refunded_amount_minor, sale.sale.currency_code, sale.sale.currency_exponent)}</TableCell></TableRow>)}</TableBody></Table></Card>
  </section>
}
