import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RetailLocation } from '@madina/retail'
import { Alert, Button, Card, EmptyState, Input, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@madina/ui'
import { getRetailCompletedSales, getRetailLocations, type RetailCompletedSales } from '../../shared/api/retailApi'
import { retailSaleDetailPath } from './retailSalesLinks'
import { retailPaymentMethodLabel } from '../../shared/retail/presentation'

function money(value: number, currency: string, exponent: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(value / 10 ** exponent)
}

export function RetailSalesJournal() {
  const [locations, setLocations] = useState<RetailLocation[]>([])
  const [locationId, setLocationId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [history, setHistory] = useState<RetailCompletedSales>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const generation = useRef(0)

  function load(nextLocationId = locationId, cursor?: string, append = false) {
    if (!nextLocationId) return
    const current = generation.current + 1
    generation.current = current
    if (append) setLoadingMore(true); else setLoading(true)
    setError(undefined)
    void getRetailCompletedSales(nextLocationId, { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, cursor })
      .then((value) => {
        if (generation.current !== current) return
        setHistory((previous) => append && previous ? { items: [...previous.items, ...value.items], nextCursor: value.nextCursor } : value)
      })
      .catch((reason: unknown) => { if (generation.current === current) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить продажи.') })
      .finally(() => { if (generation.current === current) { setLoading(false); setLoadingMore(false) } })
  }

  useEffect(() => {
    void getRetailLocations().then((value) => {
      setLocations(value)
      const first = value[0]?.id
      if (first) { setLocationId(first); load(first) } else setLoading(false)
    }).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить торговые точки.'); setLoading(false) })
  }, [])

  return <section>
    <header><h1>Журнал розничных продаж</h1><p>Завершённые продажи выбранной торговой точки.</p></header>
    <Card>
      <label>Торговая точка <Select value={locationId} onChange={event => { setLocationId(event.target.value); load(event.target.value) }}><option value="">Выберите торговую точку</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name} ({location.code})</option>)}</Select></label>
      <label>С даты <Input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></label>
      <label>По дату <Input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} /></label>
      <Button type="button" onClick={() => load()}>Применить</Button>
    </Card>
    {error && <Alert variant="danger" title="Не удалось загрузить журнал">{error}</Alert>}
    {loading ? <p>Загрузка продаж…</p> : history?.items.length ? <Card><Table><TableHead><TableRow><TableHeader>Дата</TableHeader><TableHeader>Продажа</TableHeader><TableHeader>Оплата</TableHeader><TableHeader>Итого</TableHeader><TableHeader>Возвраты</TableHeader></TableRow></TableHead><TableBody>{history.items.map(sale => <TableRow key={sale.id}><TableCell>{new Date(sale.completedAt).toLocaleString('ru-RU')}</TableCell><TableCell><Link to={retailSaleDetailPath(locationId, sale.id)}>{sale.id}</Link></TableCell><TableCell>{sale.paymentMethods.map(retailPaymentMethodLabel).join(', ') || '—'}</TableCell><TableCell>{money(sale.payableTotalMinor, sale.currencyCode, sale.currencyExponent)}</TableCell><TableCell>{sale.hasReturns ? 'Есть' : 'Нет'}</TableCell></TableRow>)}</TableBody></Table>{history.nextCursor && <Button type="button" variant="secondary" disabled={loadingMore} onClick={() => load(locationId, history.nextCursor, true)}>{loadingMore ? 'Загрузка…' : 'Показать ещё'}</Button>}</Card> : <EmptyState title="Завершённых продаж нет" description="Для выбранных условий пока нет retail продаж." />}
  </section>
}
