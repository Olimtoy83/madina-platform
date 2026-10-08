import { useEffect, useRef, useState } from 'react'
import type { RetailLocation, RetailProduct } from '@madina/retail'
import { Alert, Button, Card, ConfirmDialog, EmptyState, Input, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@madina/ui'
import { useAuth } from '../../context/useAuth'
import { canRetail } from '../../shared/auth/retailPermissions'
import { createRetailTransfer, dispatchRetailTransfer, getRetailLocations, getRetailProducts, getRetailTransfer, getRetailTransfers, isRetailInsufficientStockError, receiveRetailTransfer, type RetailTransferDetail, type RetailTransferPage } from '../../shared/api/retailApi'

type DraftLine = { productId:string; productName:string; productSourceId:string; quantity:string }
type Confirmation = 'dispatch' | 'receive'

const statusLabel: Record<'draft'|'dispatched'|'received',string> = { draft:'Черновик', dispatched:'Отправлено', received:'Принято' }

export function RetailTransfers() {
  const { user } = useAuth()
  const [locations,setLocations] = useState<RetailLocation[]>([])
  const [locationId,setLocationId] = useState('')
  const [page,setPage] = useState<RetailTransferPage>()
  const [detail,setDetail] = useState<RetailTransferDetail>()
  const [creating,setCreating] = useState(false)
  const [sourceLocationId,setSourceLocationId] = useState('')
  const [destinationLocationId,setDestinationLocationId] = useState('')
  const [productSearch,setProductSearch] = useState('')
  const [products,setProducts] = useState<RetailProduct[]>([])
  const [lines,setLines] = useState<DraftLine[]>([])
  const [error,setError] = useState<string>()
  const [notice,setNotice] = useState<string>()
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [confirmation,setConfirmation] = useState<Confirmation>()
  const submitting = useRef(false)
  const canManage = canRetail(user,'retail:transfers:manage')
  const activeLocations = locations.filter(location => location.status === 'active')

  function load(nextLocationId=locationId,cursor?:string,append=false) {
    if (!nextLocationId) return
    setLoading(true); setError(undefined)
    void getRetailTransfers(nextLocationId,{cursor}).then(value => setPage(previous => append && previous ? { items:[...previous.items,...value.items],nextCursor:value.nextCursor } : value)).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить перемещения.')).finally(() => setLoading(false))
  }

  useEffect(() => {
    void getRetailLocations().then(value => {
      setLocations(value)
      const first = value.find(location => location.status === 'active')
      if (first) { setLocationId(first.id); load(first.id) } else setLoading(false)
    }).catch(reason => { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить точки.'); setLoading(false) })
  }, [])

  function open(transferId:string) {
    if (!locationId) return
    setError(undefined); setNotice(undefined)
    void getRetailTransfer(locationId,transferId).then(value => { setDetail(value); setCreating(false) }).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось открыть перемещение.'))
  }

  function refreshDetail() {
    if (!detail) return
    setBusy(true); setError(undefined)
    void getRetailTransfer(detail.transfer.sourceLocationId,detail.transfer.id).then(value => { setDetail(value); setNotice('Документ обновлён по данным сервера.') }).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось обновить документ.')).finally(() => setBusy(false))
  }

  function searchProducts(value:string) {
    setProductSearch(value)
    if (!value.trim()) { setProducts([]); return }
    void getRetailProducts(value).then(items => setProducts(items.filter(item => item.status === 'active'))).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось найти товар.'))
  }

  function add(product:RetailProduct) {
    if (lines.some(line => line.productId === product.id)) { setError('Этот товар уже добавлен в перемещение.'); return }
    setLines([...lines,{ productId:product.id,productName:product.name,productSourceId:product.sourceId,quantity:'1' }]); setProductSearch(''); setProducts([])
  }

  function openCreate() {
    const first = activeLocations[0]?.id ?? ''
    setCreating(true); setDetail(undefined); setSourceLocationId(locationId || first); setDestinationLocationId(activeLocations.find(location => location.id !== (locationId || first))?.id ?? ''); setLines([]); setProducts([]); setProductSearch(''); setError(undefined); setNotice(undefined)
  }

  function validDraft(): boolean {
    if (!sourceLocationId || !destinationLocationId || sourceLocationId === destinationLocationId) { setError('Выберите разные активные точки отправки и приёма.'); return false }
    if (!lines.length || lines.some(line => !Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) <= 0)) { setError('Добавьте хотя бы один товар с положительным целым количеством.'); return false }
    return true
  }

  async function create() {
    if (submitting.current || !validDraft()) return
    submitting.current = true; setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const value = await createRetailTransfer(sourceLocationId,{ destinationLocationId,lines:lines.map(line => ({ productId:line.productId,quantity:Number(line.quantity) })) })
      setDetail(value); setCreating(false); setLocationId(sourceLocationId); await getRetailTransfers(sourceLocationId).then(setPage)
    } catch (reason) {
      setError(reason instanceof Error ? `${reason.message} Не повторяйте создание автоматически: обновите журнал и проверьте черновики.` : 'Не удалось создать перемещение. Обновите журнал и проверьте черновики.')
      setNotice('Ответ мог быть потерян после обработки запроса. Обновите журнал перед повторной попыткой.')
    } finally { submitting.current = false; setBusy(false) }
  }

  async function perform(action:Confirmation) {
    if (!detail || submitting.current) return
    submitting.current = true; setBusy(true); setError(undefined)
    try {
      if (action === 'dispatch') await dispatchRetailTransfer(detail.transfer.sourceLocationId,detail.transfer.id)
      else await receiveRetailTransfer(detail.transfer.destinationLocationId,detail.transfer.id)
      const refreshed = await getRetailTransfer(detail.transfer.sourceLocationId,detail.transfer.id)
      setDetail(refreshed); setConfirmation(undefined); await getRetailTransfers(locationId).then(setPage)
    } catch (reason) {
      const message = isRetailInsufficientStockError(reason) ? 'Недостаточно остатка на точке отправки. Документ остаётся черновиком.' : reason instanceof Error ? reason.message : 'Не удалось выполнить операцию.'
      setError(`${message} Обновите документ по данным сервера перед повторной попыткой.`)
      setNotice('Статус операции неизвестен до обновления документа.')
      setConfirmation(undefined)
    } finally { submitting.current = false; setBusy(false) }
  }

  const transfer = detail?.transfer
  const sourceName = (id:string) => locations.find(location => location.id === id)?.name ?? id
  const editable = creating && canManage
  return <section><header><h1>Розница: перемещения</h1><p>Перемещения между разрешёнными активными retail-точками: отправка уменьшает остаток источника, приёмка увеличивает остаток назначения.</p></header>
    <Card><label>Точка журнала <Select value={locationId} onChange={event => { setLocationId(event.target.value); setDetail(undefined); setCreating(false); load(event.target.value) }}><option value="">Выберите точку</option>{activeLocations.map(location => <option key={location.id} value={location.id}>{location.name} ({location.code})</option>)}</Select></label>{canManage && <Button type="button" onClick={openCreate}>Новое перемещение</Button>}{notice && <Button type="button" variant="secondary" disabled={busy} onClick={() => detail ? refreshDetail() : load(locationId)}>Обновить {detail ? 'документ' : 'журнал'}</Button>}</Card>
    {error && <Alert variant="danger" title="Операция не выполнена">{error}</Alert>}{notice && <Alert variant="info" title="Проверка состояния">{notice}</Alert>}
    {loading ? <p>Загрузка перемещений…</p> : page?.items.length ? <Card><Table><TableHead><TableRow><TableHeader>Дата</TableHeader><TableHeader>Откуда</TableHeader><TableHeader>Куда</TableHeader><TableHeader>Статус</TableHeader><TableHeader>Действие</TableHeader></TableRow></TableHead><TableBody>{page.items.map(item => <TableRow key={item.id}><TableCell>{new Date(item.createdAt).toLocaleString('ru-RU')}</TableCell><TableCell>{sourceName(item.sourceLocationId)}</TableCell><TableCell>{sourceName(item.destinationLocationId)}</TableCell><TableCell>{statusLabel[item.status]}</TableCell><TableCell><Button type="button" variant="secondary" onClick={() => open(item.id)}>Открыть</Button></TableCell></TableRow>)}</TableBody></Table>{page.nextCursor && <Button type="button" variant="secondary" onClick={() => load(locationId,page.nextCursor,true)}>Показать ещё</Button>}</Card> : <EmptyState title="Перемещений нет" description="Создайте черновик перемещения при наличии разрешения." />}
    {editable && <Card><h2>Новое перемещение</h2><label>Точка отправки <Select value={sourceLocationId} onChange={event => setSourceLocationId(event.target.value)}><option value="">Выберите точку</option>{activeLocations.map(location => <option key={location.id} value={location.id}>{location.name} ({location.code})</option>)}</Select></label><label>Точка приёма <Select value={destinationLocationId} onChange={event => setDestinationLocationId(event.target.value)}><option value="">Выберите точку</option>{activeLocations.map(location => <option key={location.id} value={location.id}>{location.name} ({location.code})</option>)}</Select></label><label>Найти активный retail-товар <Input value={productSearch} onChange={event => searchProducts(event.target.value)} /></label>{products.map(product => <Button key={product.id} type="button" variant="secondary" onClick={() => add(product)}>{product.name} ({product.sourceId})</Button>)}<TransferLines lines={lines} editable onChange={setLines} /><Button type="button" disabled={busy} onClick={() => void create()}>{busy ? 'Создание…' : 'Создать черновик'}</Button></Card>}
    {detail && <Card><h2>Перемещение: {statusLabel[transfer!.status]}</h2><p>Откуда: <strong>{sourceName(transfer!.sourceLocationId)}</strong>. Куда: <strong>{sourceName(transfer!.destinationLocationId)}</strong>.</p><TransferLines lines={detail.lines.map(line => ({ ...line,quantity:String(line.quantity) }))} />{canManage && transfer!.status === 'draft' && <Button type="button" disabled={busy} onClick={() => setConfirmation('dispatch')}>Отправить перемещение</Button>}{canManage && transfer!.status === 'dispatched' && <Button type="button" disabled={busy} onClick={() => setConfirmation('receive')}>Принять перемещение</Button>}{transfer!.status === 'received' && <p>Перемещение принято и доступно только для чтения.</p>}</Card>}
    {confirmation && <ConfirmDialog open onClose={() => setConfirmation(undefined)} title={confirmation === 'dispatch' ? 'Отправить перемещение?' : 'Принять перемещение?'} description={confirmation === 'dispatch' ? 'Остаток будет списан с точки отправки. Подтвердите действие.' : 'Остаток будет зачислен на точку приёма. Подтвердите действие.'} confirmLabel={confirmation === 'dispatch' ? 'Отправить' : 'Принять'} cancelLabel="Назад" loading={busy} onConfirm={() => void perform(confirmation)} />}
  </section>
}

function TransferLines({ lines,editable=false,onChange }: { lines:ReadonlyArray<DraftLine>; editable?:boolean; onChange?: (lines:DraftLine[]) => void }) {
  return <Table><TableHead><TableRow><TableHeader>Товар</TableHeader><TableHeader>Количество</TableHeader>{editable && <TableHeader>Действие</TableHeader>}</TableRow></TableHead><TableBody>{lines.map((line,index) => <TableRow key={line.productId}><TableCell><strong>{line.productName}</strong><br /><span>{line.productSourceId}</span></TableCell><TableCell>{editable ? <Input type="number" min="1" step="1" value={line.quantity} onChange={event => onChange?.(lines.map((item,current) => current === index ? { ...item,quantity:event.target.value } : item))} /> : line.quantity}</TableCell>{editable && <TableCell><Button type="button" variant="secondary" onClick={() => onChange?.(lines.filter((_,current) => current !== index))}>Удалить</Button></TableCell>}</TableRow>)}</TableBody></Table>
}
