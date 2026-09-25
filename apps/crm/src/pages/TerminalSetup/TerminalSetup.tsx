import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RetailLocation, RetailProduct } from '@madina/retail'
import { Alert, Button, Card, Input, Select } from '@madina/ui'
import { useAuth } from '../../context/useAuth'
import { getRetailLocations, getRetailProductPrice, getRetailProducts } from '../../shared/api/retailApi'
import { HttpError } from '../../shared/api/httpClient'
import { beginAuthorityIssuance, getAuthorityIssuanceState, resumeAuthorityIssuance, type AuthorityIssuanceState } from '../../shared/offline/authorityIssuance'
import { installOfflineAuthority, listInstallableOfflineAuthorities, type InstallableOfflineAuthorityResult } from '../../shared/offline/offlineAuthorityLedger'
import { checkTerminalReadiness, type TerminalReadiness, type TerminalReadinessReason } from '../../shared/offline/terminalReadiness'
import { beginTerminalEnrollment, getTerminalProvisioningState, type TerminalProvisioningState } from '../../shared/offline/terminalProvisioning'

type Observation = { locationId: string; issuance: AuthorityIssuanceState; readiness: TerminalReadiness; provisioning?: TerminalProvisioningState; discovery?: InstallableOfflineAuthorityResult }
const reasons: Record<TerminalReadinessReason, string> = {
  READY: 'Готов к офлайн-работе сейчас', UNAUTHENTICATED: 'Требуется вход', CAPABILITY_DENIED: 'Недостаточно прав', LOCATION_ACCESS_DENIED: 'Нет доступа к торговой точке', SERVER_UNAVAILABLE: 'Сервер недоступен',
  IDENTITY_MISSING: 'Этот браузер ещё не зарегистрирован', PROVISIONING_PENDING: 'Регистрация или смена ключа не завершена', TERMINAL_NOT_ENROLLED: 'Регистрация не завершена',
  TERMINAL_MISSING: 'Терминал отсутствует на сервере', TERMINAL_REVOKED: 'Терминал отозван', TERMINAL_MISMATCH: 'Данные терминала не совпадают', KEY_VERSION_MISMATCH: 'Версия ключа не совпадает',
  AUTHORITY_MISSING: 'Локальная Authority ещё не установлена', AUTHORITY_EXPIRED: 'Срок Authority истёк', AUTHORITY_REVOKED: 'Authority отозвана', AUTHORITY_MISMATCH: 'Данные Authority не совпадают',
  PERMIT_UNAVAILABLE: 'Нет доступных разрешений', INTEGRITY_ERROR: 'Целостность локального состояния не подтверждена',
}
const discoveryReasons: Record<Exclude<InstallableOfflineAuthorityResult['status'], 'OK'>, string> = {
  AUTH_REQUIRED: 'Требуется повторный вход', ACCESS_DENIED: 'Доступ отклонён', IDENTITY_MISSING: 'Нет локальной идентичности', IDENTITY_INVALID: 'Локальная идентичность повреждена',
  LOCAL_STATE_INVALID: 'Локальное состояние не подтверждено', SERVER_UNAVAILABLE: 'Сервер недоступен', SERVER_DATA_INVALID: 'Ответ сервера не удалось проверить',
}
const issuanceReasons: Record<AuthorityIssuanceState['state'], string> = {
  NONE: 'Незавершённой команды выпуска нет', PENDING: 'Команда сохранена; исход требует восстановления', AUTH_HOLD: 'Команда сохранена; восстановите вход',
  ACCESS_HOLD: 'Команда сохранена; проверьте доступ', REVIEW_HOLD: 'Требуется проверка администратором; не повторяйте выпуск вслепую', COMPLETED: 'Выпуск подтверждён, но Authority ещё не установлена',
}
const safeError = (error: unknown): string => error instanceof HttpError && error.status === 401 ? 'Требуется повторный вход.'
  : error instanceof HttpError && error.status === 403 ? 'Доступ отклонён.'
    : error instanceof TypeError || error instanceof HttpError && error.status >= 500 ? 'Сервер недоступен.'
      : 'Действие не подтверждено. Проверьте состояние или обратитесь к администратору.'
const dateText = (value: string): string => new Date(value).toLocaleString('ru-RU')

export function TerminalSetup() {
  const auth = useAuth()
  const [locations, setLocations] = useState<RetailLocation[]>([])
  const [locationId, setLocationId] = useState('')
  const [observation, setObservation] = useState<Observation | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const readId = useRef(0)
  const selectedLocationRef = useRef('')
  const [message, setMessage] = useState('')
  const [selectedAuthorityId, setSelectedAuthorityId] = useState('')
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<RetailProduct[]>([])
  const [selectedProducts, setSelectedProducts] = useState<RetailProduct[]>([])
  const [productBusy, setProductBusy] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')
  const [permitCount, setPermitCount] = useState('')
  const session = useMemo(() => ({ user: auth.user, isLoading: auth.isLoading, error: auth.error }), [auth.user, auth.isLoading, auth.error])

  useEffect(() => {
    let mounted = true
    void getRetailLocations().then(items => { if (mounted) setLocations(items.filter(item => item.type === 'store' && item.status === 'active' && !!item.currencyCode && Number.isSafeInteger(item.currencyExponent))) })
      .catch(error => { if (mounted) setMessage(safeError(error)) })
    return () => { mounted = false }
  }, [])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (selectedLocationRef.current !== locationId || signal?.aborted) return
    const id = ++readId.current
    setObservation(null)
    setSelectedAuthorityId('')
    if (!locationId) { setLoading(false); return }
    setLoading(true)
    try {
      const issuance = await getAuthorityIssuanceState()
      const readiness = await checkTerminalReadiness(locationId, session)
      const provisioning = ['PROVISIONING_PENDING', 'TERMINAL_NOT_ENROLLED'].includes(readiness.reason) ? await getTerminalProvisioningState() : undefined
      let discovery: InstallableOfflineAuthorityResult | undefined
      if (issuance.state === 'NONE' && ['AUTHORITY_MISSING', 'AUTHORITY_EXPIRED', 'AUTHORITY_REVOKED', 'PERMIT_UNAVAILABLE'].includes(readiness.reason)) {
        discovery = await listInstallableOfflineAuthorities(locationId, session)
      }
      if (readId.current === id && selectedLocationRef.current === locationId && !signal?.aborted) setObservation({ locationId, issuance, readiness, provisioning, discovery })
    } catch { if (readId.current === id && selectedLocationRef.current === locationId && !signal?.aborted) setMessage('Состояние не удалось безопасно проверить. Обратитесь к администратору.') }
    finally { if (readId.current === id && selectedLocationRef.current === locationId && !signal?.aborted) setLoading(false) }
  }, [locationId, session])
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return refresh(controller.signal) })
    return () => controller.abort()
  }, [refresh])

  function changeLocation(nextLocationId: string): void {
    if (nextLocationId === locationId) return
    selectedLocationRef.current = nextLocationId
    readId.current++
    setLocationId(nextLocationId)
    setObservation(null)
    setSelectedAuthorityId('')
    setSelectedProducts([])
    setProducts([])
    setQuery('')
    setExpiresAt('')
    setPermitCount('')
    setMessage('')
    setLoading(!!nextLocationId)
  }
  async function action(expectedLocationId: string, task: () => Promise<unknown>): Promise<void> {
    if (busyRef.current || !expectedLocationId || selectedLocationRef.current !== expectedLocationId || observation?.locationId !== expectedLocationId) return
    busyRef.current = true; setBusy(true); setMessage('')
    try { await task() } catch (error) { setMessage(safeError(error)) }
    finally { if (selectedLocationRef.current === expectedLocationId) await refresh(); busyRef.current = false; setBusy(false) }
  }
  async function register(): Promise<void> {
    await action(locationId, async () => {
      const fresh = await checkTerminalReadiness(locationId, session)
      if (!['IDENTITY_MISSING', 'TERMINAL_NOT_ENROLLED', 'PROVISIONING_PENDING'].includes(fresh.reason)) throw new Error('Enrollment changed.')
      const state = await getTerminalProvisioningState()
      if (state !== 'UNINITIALIZED' && state !== 'KEY_GENERATED') throw new Error('Enrollment changed.')
      await beginTerminalEnrollment(locationId)
    })
  }
  async function findProducts(): Promise<void> {
    if (!query.trim() || !locationId || busy || productBusy) return
    const requestedLocationId = locationId
    setProductBusy(true); setMessage('')
    try {
      const found = await getRetailProducts(query)
      if (selectedLocationRef.current === requestedLocationId) setProducts(found.filter(item => item.status === 'active' && item.baseUnit === 'piece'))
    } catch (error) { if (selectedLocationRef.current === requestedLocationId) { setProducts([]); setMessage(safeError(error)) } }
    finally { setProductBusy(false) }
  }
  async function addProduct(product: RetailProduct): Promise<void> {
    if (busy || productBusy || selectedProducts.some(item => item.id === product.id)) return
    const requestedLocationId = locationId
    setProductBusy(true)
    try {
      const price = await getRetailProductPrice(requestedLocationId, product.id)
      if (!Number.isSafeInteger(price) || price < 0) throw new Error('Price unavailable.')
      if (selectedLocationRef.current === requestedLocationId) setSelectedProducts(items => items.some(item => item.id === product.id) ? items : [...items, product])
    } catch (error) { if (selectedLocationRef.current === requestedLocationId) setMessage(safeError(error)) } finally { setProductBusy(false) }
  }
  async function issue(): Promise<void> {
    if (!observation || observation.locationId !== locationId || selectedLocationRef.current !== locationId || observation.issuance.state !== 'NONE' || observation.discovery?.status !== 'OK' || observation.discovery.authorities.length || observation.readiness.reason !== 'AUTHORITY_MISSING') return
    const expiry = new Date(expiresAt), count = Number(permitCount)
    if (!expiresAt || Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now() || !Number.isSafeInteger(count) || count <= 0 || !selectedProducts.length) {
      setMessage('Укажите будущий срок, положительное целое число разрешений и хотя бы один товар.'); return
    }
    await action(locationId, async () => {
      if ((await getAuthorityIssuanceState()).state !== 'NONE') throw new Error('Issuance changed.')
      if ((await checkTerminalReadiness(locationId, session)).reason !== 'AUTHORITY_MISSING') throw new Error('Readiness changed.')
      const existing = await listInstallableOfflineAuthorities(locationId, session)
      if (existing.status !== 'OK' || existing.authorities.length) throw new Error('Discovery changed.')
      await beginAuthorityIssuance({ locationId, expiresAt: expiry.toISOString(), permitCount: count, productIds: selectedProducts.map(item => item.id) }, session)
    })
  }

  const currentObservation = observation?.locationId === locationId ? observation : null
  const readiness = currentObservation?.readiness, issuance = currentObservation?.issuance, discovery = currentObservation?.discovery
  const ready = readiness?.status === 'READY'
  const commandMatches = issuance?.state === 'NONE' || issuance?.locationId === locationId
  const canRegister = !busy && !loading && issuance?.state === 'NONE' && !!readiness
    && (readiness.reason === 'IDENTITY_MISSING' || (readiness.reason === 'TERMINAL_NOT_ENROLLED' || readiness.reason === 'PROVISIONING_PENDING') && currentObservation?.provisioning === 'KEY_GENERATED')
  const candidates = discovery?.status === 'OK' ? discovery.authorities : []
  const installId = issuance?.state === 'COMPLETED' ? issuance.authorityId : candidates.length === 1 ? candidates[0]?.authorityId : selectedAuthorityId

  return <section aria-label="Подготовка терминала">
    <header><h1>Подготовка терминала</h1><p>Настройка относится только к этому браузеру и его профилю, не ко всем терминалам.</p></header>
    <p><Link to="/retail/offline-operations">Офлайн-операции этого браузера</Link></p>
    <Card>
      <label htmlFor="setup-location">Торговая точка</label>
      <Select id="setup-location" value={locationId} onChange={event => changeLocation(event.target.value)} disabled={busy || productBusy}>
        <option value="">Выберите торговую точку</option>
        {locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Select>
      {locationId && <Button type="button" variant="secondary" onClick={() => void refresh()} disabled={busy || loading}>Проверить снова</Button>}
    </Card>
    {message && <Alert variant="warning" title="Не подтверждено">{message}</Alert>}
    {loading && <p role="status">Проверяем состояние…</p>}
    {readiness && !loading && <Card>
      <h2>{ready ? 'Готов сейчас' : 'Пока не готов'}</h2><p>{reasons[readiness.reason]}</p>
      {readiness.terminalId && <p>ID терминала: {readiness.terminalId}</p>}
      {readiness.terminalKeyVersion && <p>Версия ключа: {readiness.terminalKeyVersion}</p>}
      {readiness.authorityId && <p>ID Authority: {readiness.authorityId}</p>}
      {readiness.authorityExpiresAt && <p>Срок Authority: {dateText(readiness.authorityExpiresAt)}</p>}
      {ready ? <p>Доступных разрешений: {readiness.availablePermitCount}. Готовность подтверждена только на момент проверки.</p>
        : ['TERMINAL_MISSING', 'TERMINAL_REVOKED', 'TERMINAL_MISMATCH', 'KEY_VERSION_MISMATCH', 'AUTHORITY_MISMATCH', 'INTEGRITY_ERROR'].includes(readiness.reason) && <p>Не сбрасывайте данные браузера. Обратитесь к администратору.</p>}
    </Card>}
    {!ready && !loading && issuance && <Card>
      <h2>Выпуск Authority</h2><p>{issuanceReasons[issuance.state]}</p>
      {!commandMatches && <p>Сохранённая команда относится к другой точке. Новый выпуск заблокирован.</p>}
      {['PENDING', 'AUTH_HOLD', 'ACCESS_HOLD'].includes(issuance.state) && commandMatches && <Button type="button" onClick={() => void action(locationId, () => resumeAuthorityIssuance(session))} disabled={busy}>Возобновить ту же команду</Button>}
      {issuance.state === 'COMPLETED' && <p>ID подтверждённой Authority: {issuance.authorityId}</p>}
    </Card>}
    {canRegister && <Button type="button" onClick={() => void register()} disabled={busy}>Зарегистрировать этот браузер</Button>}
    {!ready && !loading && issuance?.state === 'NONE' && discovery && <Card>
      <h2>Существующая Authority</h2>
      {discovery.status !== 'OK' ? <Alert variant="warning" title="Поиск не завершён">{discoveryReasons[discovery.status]}. Новый выпуск заблокирован.</Alert>
        : candidates.length === 0 ? <p>Совместимая существующая Authority не найдена: проверка завершилась успешно.</p>
          : <><p>Для установки требуется отдельное подтверждение.</p>{candidates.map(item => <label key={item.authorityId} style={{ display: 'block' }}>
            {candidates.length > 1 && <input type="radio" name="setup-authority" checked={selectedAuthorityId === item.authorityId} onChange={() => setSelectedAuthorityId(item.authorityId)} disabled={busy} />}
            ID {item.authorityId}; срок {dateText(item.expiresAt)}; разрешений {item.availablePermitCount}; версия ключа {item.terminalKeyVersion}
          </label>)}</>}
    </Card>}
    {!ready && !loading && commandMatches && installId && readiness && ['AUTHORITY_MISSING', 'AUTHORITY_EXPIRED', 'AUTHORITY_REVOKED', 'PERMIT_UNAVAILABLE'].includes(readiness.reason) && (issuance?.state === 'COMPLETED' || issuance?.state === 'NONE' && candidates.some(item => item.authorityId === installId)) && <Button type="button" onClick={() => void action(locationId, () => installOfflineAuthority(locationId, installId, auth.user!.id))} disabled={busy || !auth.user}>Установить Authority {installId}</Button>}
    {!ready && !loading && issuance?.state === 'NONE' && readiness?.reason === 'AUTHORITY_MISSING' && discovery?.status === 'OK' && candidates.length === 0 && <Card>
      <h2>Новая Authority</h2><p>Срок, товары и число разрешений сохранятся в неизменяемой команде после нажатия.</p>
      <label htmlFor="setup-expiry">Срок действия</label><Input id="setup-expiry" type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} disabled={busy} />
      <label htmlFor="setup-permits">Число офлайн-разрешений</label><Input id="setup-permits" type="number" min="1" step="1" value={permitCount} onChange={event => setPermitCount(event.target.value)} disabled={busy} />
      <label htmlFor="setup-search">Товар из каталога</label><Input id="setup-search" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} />
      <Button type="button" variant="secondary" onClick={() => void findProducts()} disabled={busy || productBusy || !query.trim()}>Найти товары</Button>
      {products.map(item => <p key={item.id}>{item.name} ({item.id}) <Button type="button" variant="secondary" onClick={() => void addProduct(item)} disabled={busy || productBusy || selectedProducts.some(selected => selected.id === item.id)}>Добавить</Button></p>)}
      <p>Выбрано товаров: {selectedProducts.length}</p>
      {selectedProducts.map(item => <p key={item.id}>{item.name} <Button type="button" variant="secondary" onClick={() => setSelectedProducts(items => items.filter(selected => selected.id !== item.id))} disabled={busy}>Убрать</Button></p>)}
      <Button type="button" onClick={() => void issue()} disabled={busy || productBusy || !selectedProducts.length || !expiresAt || !permitCount}>Начать выпуск Authority</Button>
    </Card>}
  </section>
}
