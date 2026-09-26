import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { RetailLocation, RetailProduct } from '@madina/retail'
import {
  getRetailLocations,
  getRetailProductByBarcode,
  getRetailProductPrice,
  getRetailProducts,
  completeRetailSale,
  completeRetailReturn,
  getRetailCompletedSale,
  type RetailCompletedSale,
  type RetailReturnCompletionResult,
} from '../../shared/api/retailApi'
import { HttpError } from '../../shared/api/httpClient'
import { useAuth } from '../../context/useAuth'
import { canRetail } from '../../shared/auth/retailPermissions'
import { Alert, Button, Card, EmptyState, Input, Spinner } from '@madina/ui'
import { usePendingCommand } from '../../shared/usePendingCommand'
import { useCommitOfflineSale, type OfflineSaleIntent } from '../../shared/offline/offlineLocalSale'
import { loadOfflineAuthority } from '../../shared/offline/offlineAuthorityLedger'
import { readLocalOfflineOperations } from '../../shared/offline/offlineOperationsProjection'
import { checkTerminalReadiness, type TerminalReadiness } from '../../shared/offline/terminalReadiness'
import {
  addPosCartLine,
  calculatePosCartTotals,
  clearPosCart,
  decrementPosCartLine,
  incrementPosCartLine,
  removePosCartLine,
  setPosCartLineDiscount,
  setPosCartLinePercentDiscount,
  parsePosCartDiscountPercentBasisPoints,
  type PosCartLine,
} from './retailPosCart'
import { createPosCheckoutAttempt, type PosCheckoutAttempt } from './retailPosCheckout'
import {
  addPosPaymentAllocation,
  createDefaultPosPaymentAllocations,
  removePosPaymentAllocation,
  parsePosPaymentAmount,
  summarizePosPayments,
  updatePosPaymentAllocationAmount,
  updatePosPaymentAllocationMethod,
  type PosPaymentAllocation,
  type PosPaymentMethod,
} from './retailPosPayments'
import {
  clearPendingPosSaleSubmission,
  loadPendingPosSaleSubmission,
  savePendingPosSaleSubmission,
  type PendingPosSaleSubmission,
} from './retailPosSubmissionRecovery'
import { createPosCompletionPayload } from './retailPosCompletionPayload'
import { retryPendingPosSale, submitPosSale } from './retailPosSubmissionOrchestration'
import {
  canPreparePosCheckout,
  createPosRecoveryGateState,
  type PosRecoveryGateBlockedReason,
  type PosRecoveryGateState,
} from './retailPosRecoveryGate'
import {
  clearPendingPosReturnSubmission,
  loadPendingPosReturnSubmission,
  savePendingPosReturnSubmission,
  type PendingPosReturnSubmission,
} from './retailPosReturnRecovery'
import {
  createPosReturnIntent,
  retryPendingPosReturn,
  submitPosReturn,
} from './retailPosReturnSubmission'
import './RetailPos.css'

type ProductSearchState = 'idle' | 'loading' | 'empty' | 'ready' | 'error'
type BarcodeLookupState = 'idle' | 'loading' | 'found' | 'not-found' | 'unavailable' | 'error'
type PriceState = 'idle' | 'loading' | 'ready' | 'missing' | 'currency-unavailable' | 'error'
type SubmissionState = 'idle' | 'submitting' | 'assembly-error' | 'blocked' | 'cleanup-failed' | 'succeeded'
type RecoveryRetryState = 'idle' | 'retrying' | 'failed' | 'cleanup-failed' | 'succeeded'
type DiscountMode = 'amount' | 'percent'
type ReturnLookupState = 'idle' | 'loading' | 'loaded' | 'not-found' | 'denied' | 'error'
type ReturnSubmissionState = 'idle' | 'submitting' | 'unknown-result' | 'rejected' | 'cleanup-failed' | 'succeeded'
type OfflineAttempt = { key: string; locationId: string; authorityId: string; intent: OfflineSaleIntent; totalMinor: number; currencyCode: string; currencyExponent: number; quantity: number }

type CurrencyConfiguredLocation = RetailLocation & {
  currencyCode: string
  currencyExponent: number
}

function getLookupErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Не удалось выполнить поиск товара. Повторите попытку.'
}

function hasCurrencyConfiguration(
  location: RetailLocation,
): location is CurrencyConfiguredLocation {
  return typeof location.currencyCode === 'string'
    && /^[A-Z]{3}$/.test(location.currencyCode)
    && typeof location.currencyExponent === 'number'
    && Number.isSafeInteger(location.currencyExponent)
    && location.currencyExponent >= 0
    && location.currencyExponent <= 9
}

function formatUnitPrice(
  unitPriceMinor: number,
  currencyCode: string,
  currencyExponent: number,
): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: currencyExponent,
    maximumFractionDigits: currencyExponent,
  }).format(unitPriceMinor / 10 ** currencyExponent)
}

function getCartErrorMessage(
  error: 'invalid-quantity' | 'quantity-overflow' | 'invalid-discount' | 'money-overflow',
): string {
  switch (error) {
    case 'quantity-overflow':
      return 'Количество товара не может быть больше допустимого значения.'
    case 'invalid-discount':
      return 'Скидку для позиции нельзя безопасно пересчитать.'
    case 'money-overflow':
      return 'Сумму позиции нельзя безопасно рассчитать.'
    case 'invalid-quantity':
      return 'Количество товара должно быть целым положительным числом.'
  }
}

function formatDiscountPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100)
  const fraction = basisPoints % 100
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`
}

function getRecoveryGateMessage(
  reason: PosRecoveryGateBlockedReason,
): string {
  switch (reason) {
    case 'pending':
      return 'Есть незавершённая предыдущая продажа. Создание новой оплаты временно недоступно.'
    case 'foreign-owner':
      return 'Есть незавершённые POS-данные другой сессии. Создание новой оплаты временно недоступно.'
    case 'invalid':
      return 'Сохранённые данные восстановления нельзя безопасно обработать. Создание новой оплаты временно недоступно.'
    case 'storage-error':
      return 'Защищённое локальное хранилище недоступно. Создание новой оплаты временно недоступно.'
  }
}

export function RetailPos() {
  const auth = useAuth()
  const { user } = auth
  const commitOfflineSale = useCommitOfflineSale()
  const canApplyDiscount = canRetail(user, 'retail:sales:discount')
  const canReturnSales = canRetail(user, 'retail:sales:return')
  const [locations, setLocations] = useState<RetailLocation[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState<string>()
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  )
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<RetailProduct[]>([])
  const [searchState, setSearchState] = useState<ProductSearchState>('idle')
  const [searchHasInactiveProducts, setSearchHasInactiveProducts] = useState(false)
  const [searchError, setSearchError] = useState<string>()
  const [barcode, setBarcode] = useState('')
  const [barcodeProduct, setBarcodeProduct] = useState<RetailProduct>()
  const [barcodeState, setBarcodeState] = useState<BarcodeLookupState>('idle')
  const [barcodeError, setBarcodeError] = useState<string>()
  const [selectedProduct, setSelectedProduct] = useState<RetailProduct>()
  const [priceState, setPriceState] = useState<PriceState>('idle')
  const [unitPriceMinor, setUnitPriceMinor] = useState<number>()
  const [priceError, setPriceError] = useState<string>()
  const [cartLines, setCartLines] = useState<PosCartLine[]>([])
  const [cartError, setCartError] = useState<string>()
  const [cartNotice, setCartNotice] = useState<string>()
  const [discountInputs, setDiscountInputs] = useState<Record<string, string>>({})
  const [discountModes, setDiscountModes] = useState<Record<string, DiscountMode>>({})
  const [checkoutAttempt, setCheckoutAttempt] = useState<PosCheckoutAttempt>()
  const [paymentAllocations, setPaymentAllocations] = useState<PosPaymentAllocation[]>()
  const [recoveryGate, setRecoveryGate] = useState<PosRecoveryGateState>({
    status: 'checking',
  })
  const [pendingRecoverySnapshot, setPendingRecoverySnapshot] = useState<Readonly<PendingPosSaleSubmission>>()
  const [submissionState, setSubmissionState] = useState<SubmissionState>('idle')
  const [recoveryRetryState, setRecoveryRetryState] = useState<RecoveryRetryState>('idle')
  const [returnSaleId, setReturnSaleId] = useState('')
  const [returnSale, setReturnSale] = useState<RetailCompletedSale>()
  const [returnLookupState, setReturnLookupState] = useState<ReturnLookupState>('idle')
  const [returnLookupError, setReturnLookupError] = useState<string>()
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({})
  const [pendingReturnRecovery, setPendingReturnRecovery] = useState<Readonly<PendingPosReturnSubmission>>()
  const [returnRecoveryBlocked, setReturnRecoveryBlocked] = useState<'foreign-owner' | 'invalid' | 'storage-error'>()
  const [returnSubmissionState, setReturnSubmissionState] = useState<ReturnSubmissionState>('idle')
  const [returnSuccess, setReturnSuccess] = useState<RetailReturnCompletionResult>()
  const searchRequestGeneration = useRef(0)
  const barcodeRequestGeneration = useRef(0)
  const priceRequestGeneration = useRef(0)
  const submissionGeneration = useRef(0)
  const submissionOwnerUserId = useRef<string | undefined>(undefined)
  const returnLookupGeneration = useRef(0)
  const returnSubmissionGeneration = useRef(0)
  const offlineReadGeneration = useRef(0)
  const offlineBusyRef = useRef(false)
  const offlineContextRef = useRef('')
  const offlineAttemptRef = useRef<OfflineAttempt | undefined>(undefined)
  const offlineHoldRef = useRef(false)
  const [offlineReadiness, setOfflineReadiness] = useState<{ locationId: string; userId?: string; value: TerminalReadiness }>()
  const [offlineReadinessLoading, setOfflineReadinessLoading] = useState(false)
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [offlineConfirmation, setOfflineConfirmation] = useState<OfflineAttempt>()
  const [offlineError, setOfflineError] = useState<string>()
  const [offlineHold, setOfflineHold] = useState(false)
  const [offlineSuccess, setOfflineSuccess] = useState<string>()
  const { isPending, run: runPendingCommand } = usePendingCommand()

  const invalidateOffline = useCallback(() => {
    offlineReadGeneration.current += 1
    offlineContextRef.current = ''
    setOfflineReadiness(undefined)
    setOfflineReadinessLoading(false)
    setOfflineConfirmation(undefined)
    setOfflineError(undefined)
    setOfflineSuccess(undefined)
    if (!offlineHoldRef.current) offlineAttemptRef.current = undefined
  }, [])

  const resetPriceReadiness = useCallback(() => {
    priceRequestGeneration.current += 1
    setPriceState('idle')
    setUnitPriceMinor(undefined)
    setPriceError(undefined)
  }, [])

  const resetProductLookup = useCallback(() => {
    searchRequestGeneration.current += 1
    barcodeRequestGeneration.current += 1
    setSearchTerm('')
    setSearchResults([])
    setSearchState('idle')
    setSearchHasInactiveProducts(false)
    setSearchError(undefined)
    setBarcode('')
    setBarcodeProduct(undefined)
    setBarcodeState('idle')
    setBarcodeError(undefined)
    setSelectedProduct(undefined)
    resetPriceReadiness()
  }, [resetPriceReadiness])

  const resetReturnWorkflow = useCallback(() => {
    returnLookupGeneration.current += 1
    setReturnSaleId('')
    setReturnSale(undefined)
    setReturnLookupState('idle')
    setReturnLookupError(undefined)
    setReturnQuantities({})
    setReturnSuccess(undefined)
    setReturnSubmissionState('idle')
  }, [])

  const loadLocations = useCallback(async () => {
    invalidateOffline()
    setLoadState('loading')
    setLocations([])
    setSelectedLocationId(undefined)
    resetProductLookup()
    setCartLines(clearPosCart())
    setDiscountInputs({})
    setDiscountModes({})
    setCartError(undefined)
    setCartNotice(undefined)
    setCheckoutAttempt(undefined)
    setPaymentAllocations(undefined)
    resetReturnWorkflow()

    try {
      const retailLocations = await getRetailLocations()
      setLocations(retailLocations.filter(
        (location) => location.status === 'active' && location.type === 'store',
      ))
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [invalidateOffline, resetProductLookup, resetReturnWorkflow])

  useEffect(() => {
    void loadLocations()
  }, [loadLocations])

  useEffect(() => {
    if (!user) {
      setRecoveryGate({ status: 'checking' })
      setPendingRecoverySnapshot(undefined)
      return
    }

    const recovery = loadPendingPosSaleSubmission(user.id)
    setRecoveryGate({ status: 'checking' })
    setPendingRecoverySnapshot(recovery.status === 'pending' ? recovery.snapshot : undefined)
    setRecoveryRetryState('idle')
    setRecoveryGate(createPosRecoveryGateState(user.id, recovery))
  }, [user?.id])

  useEffect(() => {
    if (!user) {
      setPendingReturnRecovery(undefined)
      setReturnRecoveryBlocked(undefined)
      return
    }
    const recovery = loadPendingPosReturnSubmission(user.id)
    setPendingReturnRecovery(recovery.status === 'pending' ? recovery.snapshot : undefined)
    setReturnRecoveryBlocked(recovery.status === 'foreign-owner' || recovery.status === 'invalid' || recovery.status === 'storage-error'
      ? recovery.status
      : undefined)
  }, [user?.id])

  useEffect(() => {
    const generation = submissionGeneration.current + 1
    submissionGeneration.current = generation
    submissionOwnerUserId.current = user?.id

    return () => {
      if (submissionGeneration.current === generation) {
        submissionGeneration.current += 1
        submissionOwnerUserId.current = undefined
      }
    }
  }, [user?.id])

  const isCheckoutPreparationAllowed = canPreparePosCheckout(recoveryGate, user?.id)

  useEffect(() => {
    if (isCheckoutPreparationAllowed) return
    setCheckoutAttempt(undefined)
    setPaymentAllocations(undefined)
  }, [isCheckoutPreparationAllowed])

  const selectedLocation = locations.find(
    (location) => location.id === selectedLocationId,
  )
  useEffect(() => {
    const locationId = selectedLocationId
    const generation = ++offlineReadGeneration.current
    if (!locationId) return
    void Promise.resolve().then(() => { if (offlineReadGeneration.current === generation) setOfflineReadinessLoading(true) })
    void checkTerminalReadiness(locationId, { user: auth.user, isLoading: auth.isLoading, error: auth.error })
      .then(value => {
        if (offlineReadGeneration.current === generation && selectedLocationId === locationId) setOfflineReadiness({ locationId, userId: auth.user?.id, value })
      })
      .catch(() => {
        if (offlineReadGeneration.current === generation) setOfflineReadiness(undefined)
      })
      .finally(() => { if (offlineReadGeneration.current === generation) setOfflineReadinessLoading(false) })
    return () => { if (offlineReadGeneration.current === generation) offlineReadGeneration.current += 1 }
  }, [selectedLocationId, auth.user, auth.isLoading, auth.error])
  const cartTotals = calculatePosCartTotals(cartLines)
  const currentOfflineReadiness = offlineReadiness && offlineReadiness.locationId === selectedLocationId && offlineReadiness.userId === user?.id ? offlineReadiness.value : undefined
  const offlineContextKey = JSON.stringify({ locationId: selectedLocationId, userId: user?.id, cartLines, checkoutAttempt, paymentAllocations, authorityId: currentOfflineReadiness?.authorityId })
  useLayoutEffect(() => { offlineContextRef.current = offlineContextKey }, [offlineContextKey])
  const cartLineTotals = cartTotals.status === 'ready'
    ? new Map(cartTotals.lineTotals.map((line) => [line.productId, line.lineTotalMinor]))
    : undefined

  const canAddSelectedProduct = selectedLocation !== undefined
    && selectedProduct?.status === 'active'
    && priceState === 'ready'
    && typeof unitPriceMinor === 'number'
    && Number.isSafeInteger(unitPriceMinor)
    && unitPriceMinor > 0
    && hasCurrencyConfiguration(selectedLocation)

  useEffect(() => {
    const generation = priceRequestGeneration.current + 1
    priceRequestGeneration.current = generation
    setUnitPriceMinor(undefined)
    setPriceError(undefined)

    if (!selectedLocation || !selectedProduct || selectedProduct.status !== 'active') {
      setPriceState('idle')
      return
    }

    if (!hasCurrencyConfiguration(selectedLocation)) {
      setPriceState('currency-unavailable')
      return
    }

    setPriceState('loading')

    void getRetailProductPrice(selectedLocation.id, selectedProduct.id)
      .then((price) => {
        if (priceRequestGeneration.current !== generation) return
        setUnitPriceMinor(price)
        setPriceState('ready')
      })
      .catch((error: unknown) => {
        if (priceRequestGeneration.current !== generation) return
        if (error instanceof HttpError && error.status === 404) {
          setPriceState('missing')
          return
        }
        setPriceError(getLookupErrorMessage(error))
        setPriceState('error')
      })
  }, [selectedLocation, selectedProduct])

  async function searchProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const term = searchTerm.trim()
    const generation = searchRequestGeneration.current + 1
    searchRequestGeneration.current = generation

    if (!term) {
      setSearchResults([])
      setSearchState('idle')
      setSearchHasInactiveProducts(false)
      setSearchError(undefined)
      return
    }

    setSearchResults([])
    setSearchState('loading')
    setSearchHasInactiveProducts(false)
    setSearchError(undefined)

    try {
      const products = await getRetailProducts(term)
      if (searchRequestGeneration.current !== generation) return
      const activeProducts = products.filter((product) => product.status === 'active')
      setSearchResults(activeProducts)
      setSearchHasInactiveProducts(products.length > activeProducts.length)
      setSearchState(activeProducts.length > 0 ? 'ready' : 'empty')
    } catch (error) {
      if (searchRequestGeneration.current !== generation) return
      setSearchError(getLookupErrorMessage(error))
      setSearchState('error')
    }
  }

  async function lookupBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = barcode.trim()
    const generation = barcodeRequestGeneration.current + 1
    barcodeRequestGeneration.current = generation

    if (!value) {
      setBarcodeProduct(undefined)
      setBarcodeState('idle')
      setBarcodeError(undefined)
      return
    }

    setBarcodeProduct(undefined)
    setBarcodeState('loading')
    setBarcodeError(undefined)

    try {
      const product = await getRetailProductByBarcode(value)
      if (barcodeRequestGeneration.current !== generation) return
      if (!product) {
        setBarcodeState('not-found')
        return
      }
      setBarcodeProduct(product)
      setBarcodeState(product.status === 'active' ? 'found' : 'unavailable')
    } catch (error) {
      if (barcodeRequestGeneration.current !== generation) return
      if (error instanceof HttpError && error.status === 404) {
        setBarcodeState('not-found')
        return
      }
      setBarcodeError(getLookupErrorMessage(error))
      setBarcodeState('error')
    }
  }

  function selectLocation(locationId: string) {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current || returnSubmissionState === 'submitting') return
    invalidateOffline()
    const hadCartLines = cartLines.length > 0
    setSelectedLocationId(locationId || undefined)
    resetProductLookup()
    setCartLines(clearPosCart())
    setDiscountInputs({})
    setDiscountModes({})
    setCartError(undefined)
    setCheckoutAttempt(undefined)
    setPaymentAllocations(undefined)
    resetReturnWorkflow()
    setCartNotice(hadCartLines
      ? 'Корзина очищена после смены торговой точки.'
      : undefined)
  }

  function selectProduct(product: RetailProduct) {
    if (offlineBusyRef.current || offlineHoldRef.current) return
    resetPriceReadiness()
    setSelectedProduct(product)
  }

  function addSelectedProductToCart() {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current) return
    if (!selectedLocation
      || !selectedProduct
      || selectedProduct.status !== 'active'
      || priceState !== 'ready'
      || typeof unitPriceMinor !== 'number'
      || !Number.isSafeInteger(unitPriceMinor)
      || unitPriceMinor <= 0
      || !hasCurrencyConfiguration(selectedLocation)) return

    const result = addPosCartLine(cartLines, {
      productId: selectedProduct.id,
      sourceId: selectedProduct.sourceId,
      name: selectedProduct.name,
      baseUnit: selectedProduct.baseUnit,
      unitPriceMinor,
      currencyCode: selectedLocation.currencyCode,
      currencyExponent: selectedLocation.currencyExponent,
    })
    setCartLines(result.lines)
    setCartError(result.error ? getCartErrorMessage(result.error) : undefined)
    if (!result.error) {
      setCheckoutAttempt(undefined)
      setPaymentAllocations(undefined)
    }
  }

  function incrementCartLine(productId: string) {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current) return
    const result = incrementPosCartLine(cartLines, productId)
    setCartLines(result.lines)
    setCartError(result.error ? getCartErrorMessage(result.error) : undefined)
    if (!result.error) {
      setCheckoutAttempt(undefined)
      setPaymentAllocations(undefined)
    }
  }

  function decrementCartLine(productId: string) {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current) return
    const result = decrementPosCartLine(cartLines, productId)
    setCartLines(result.lines)
    setCartError(result.error ? getCartErrorMessage(result.error) : undefined)
    if (result.lines.some((line, index) => line.quantity !== cartLines[index]?.quantity)) {
      setCheckoutAttempt(undefined)
      setPaymentAllocations(undefined)
    }
  }

  function updateDiscountInput(productId: string, value: string) {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current || !canApplyDiscount) return

    setDiscountInputs((current) => ({
      ...current,
      [productId]: value,
    }))
  }

  function updateDiscountMode(productId: string, mode: DiscountMode) {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current || !canApplyDiscount) return
    setDiscountModes((current) => ({ ...current, [productId]: mode }))
  }

  function applyCartLineDiscount(line: PosCartLine) {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current || !canApplyDiscount) return

    const input = discountInputs[line.productId] ?? ''
    const mode = discountModes[line.productId]
      ?? (line.discountPercentBasisPoints === undefined ? 'amount' : 'percent')
    const result = mode === 'amount'
      ? (() => {
        const parsed = parsePosPaymentAmount(input, line.currencyExponent)
        if (parsed.status !== 'ready' || parsed.amountMinor <= 0) {
          setCartError(parsed.status === 'overflow'
            ? 'Сумма скидки слишком большая.'
            : 'Введите корректную положительную сумму скидки.')
          return undefined
        }
        return setPosCartLineDiscount(cartLines, line.productId, parsed.amountMinor)
      })()
      : (() => {
        const parsed = parsePosCartDiscountPercentBasisPoints(input)
        if (parsed.status !== 'ready') {
          setCartError('Введите процент скидки от 0,01% до 99,99%.')
          return undefined
        }
        return setPosCartLinePercentDiscount(
          cartLines,
          line.productId,
          parsed.basisPoints,
        )
      })()

    if (!result) return

    if (result.error) {
      setCartError(
        result.error === 'discount-too-large'
          ? 'Скидка должна быть меньше полной суммы позиции.'
          : result.error === 'discount-rounds-to-zero'
            ? 'Процент скидки слишком мал для суммы этой позиции.'
            : result.error === 'invalid-percent'
              ? 'Введите процент скидки от 0,01% до 99,99%.'
              : result.error === 'money-overflow'
                ? 'Сумму позиции нельзя безопасно рассчитать.'
                : 'Не удалось применить скидку.',
      )
      return
    }

    setCartLines(result.lines)
    setCartError(undefined)
    setCheckoutAttempt(undefined)
    setPaymentAllocations(undefined)
  }

  function removeCartLineDiscount(productId: string) {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current || !canApplyDiscount) return

    const result = setPosCartLineDiscount(
      cartLines,
      productId,
      undefined,
    )

    if (result.error) {
      setCartError('Не удалось удалить скидку.')
      return
    }

    setCartLines(result.lines)
    setDiscountInputs((current) => {
      const { [productId]: _removed, ...rest } = current
      return rest
    })
    setDiscountModes((current) => {
      const { [productId]: _removed, ...rest } = current
      return rest
    })
    setCartError(undefined)
    setCheckoutAttempt(undefined)
    setPaymentAllocations(undefined)
  }

  function removeCartLine(productId: string) {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current) return
    setCartLines(removePosCartLine(cartLines, productId))
    setDiscountInputs((current) => {
      const { [productId]: _removed, ...rest } = current
      return rest
    })
    setDiscountModes((current) => {
      const { [productId]: _removed, ...rest } = current
      return rest
    })
    setCartError(undefined)
    if (cartLines.some((line) => line.productId === productId)) {
      setCheckoutAttempt(undefined)
      setPaymentAllocations(undefined)
    }
  }

  function clearCart() {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current) return
    setCartLines(clearPosCart())
    setDiscountInputs({})
    setDiscountModes({})
    setCartError(undefined)
    if (cartLines.length > 0) {
      setCheckoutAttempt(undefined)
      setPaymentAllocations(undefined)
    }
  }

  function prepareCheckoutAttempt() {
    if (isSubmitting || offlineBusyRef.current || offlineHoldRef.current
      || !isCheckoutPreparationAllowed
      || !selectedLocation
      || cartTotals.status !== 'ready') return

    setCheckoutAttempt(createPosCheckoutAttempt({
      locationId: selectedLocation.id,
      cartLines,
      cartTotals,
      createId: () => crypto.randomUUID(),
    }))
    setPaymentAllocations(createDefaultPosPaymentAllocations(() => crypto.randomUUID()))
    setSubmissionState('idle')
  }

  const paymentSummary = checkoutAttempt
    && selectedLocation
    && hasCurrencyConfiguration(selectedLocation)
    && cartTotals.status === 'ready'
    && paymentAllocations
    ? summarizePosPayments(
      paymentAllocations,
      cartTotals.payableTotalMinor,
      selectedLocation.currencyExponent,
    )
    : undefined
  const submissionKey = checkoutAttempt
    ? `retail-pos-submission:${checkoutAttempt.clientOperationId}`
    : undefined
  const isSubmitting = submissionKey !== undefined && isPending(submissionKey)

  function offlineGate(): { locationId: string; authorityId: string; totalMinor: number; currencyCode: string; currencyExponent: number; quantity: number } | undefined {
    if (!user || !selectedLocation || !hasCurrencyConfiguration(selectedLocation) || !checkoutAttempt || checkoutAttempt.locationId !== selectedLocation.id
      || !isCheckoutPreparationAllowed || recoveryGate.status !== 'clear' || submissionState === 'submitting' || submissionState === 'blocked'
      || isSubmitting || offlineHoldRef.current || cartTotals.status !== 'ready' || !cartLines.length
      || !paymentAllocations || paymentAllocations.length !== 1 || paymentAllocations[0]?.method !== 'cash'
      || paymentSummary?.status !== 'exact' || paymentSummary.targetMinor !== cartTotals.payableTotalMinor
      || paymentSummary.allocatedMinor !== cartTotals.payableTotalMinor || cartLines.some(line => line.discountAmountMinor !== undefined || line.discountPercentBasisPoints !== undefined)
      || checkoutAttempt.lines.length !== cartLines.length || checkoutAttempt.lines.some(line => !cartLines.some(cart => cart.productId === line.productId && cart.quantity === line.quantity && line.discountAmountMinor === undefined))
      || currentOfflineReadiness?.status !== 'READY' || !currentOfflineReadiness.serverVerified
      || currentOfflineReadiness.requestedLocationId !== selectedLocation.id || !currentOfflineReadiness.authorityId) return undefined
    return { locationId: selectedLocation.id, authorityId: currentOfflineReadiness.authorityId, totalMinor: cartTotals.payableTotalMinor,
      currencyCode: selectedLocation.currencyCode, currencyExponent: selectedLocation.currencyExponent,
      quantity: cartLines.reduce((sum, line) => sum + line.quantity, 0) }
  }

  async function validateOfflinePrices(locationId: string, authorityId: string, currencyCode: string, currencyExponent: number, lines: readonly PosCartLine[]): Promise<boolean> {
    const authority = await loadOfflineAuthority(locationId, authorityId)
    if (!authority || authority.locationId !== locationId || authority.userId !== user?.id
      || authority.currencyCode !== currencyCode || authority.currencyExponent !== currencyExponent) return false
    return lines.every(line => line.currencyCode === currencyCode && line.currencyExponent === currencyExponent
      && Number.isSafeInteger(line.quantity) && line.quantity > 0
      && authority.productPrices.some(price => price.productId === line.productId && price.unitPriceMinor === line.unitPriceMinor))
  }

  async function prepareOfflineSale() {
    if (offlineBusyRef.current) return
    const gate = offlineGate()
    if (!gate) { setOfflineError('Офлайн-продажа недоступна: проверьте готовность терминала, корзину, оплату и незавершённые продажи.'); return }
    offlineBusyRef.current = true; setOfflineBusy(true); setOfflineError(undefined); setOfflineSuccess(undefined)
    const key = offlineContextKey
    const lines = cartLines.map(line => ({ ...line }))
    try {
      const pricesMatch = await validateOfflinePrices(gate.locationId, gate.authorityId, gate.currencyCode, gate.currencyExponent, lines)
      if (offlineContextRef.current !== key) return
      if (!pricesMatch) {
        setOfflineError('Цена товара отличается от офлайн-разрешения. Подключитесь к сети и обновите данные.'); return
      }
      const prior = offlineAttemptRef.current
      const attempt: OfflineAttempt = prior?.key === key ? prior : {
        key, locationId: gate.locationId, authorityId: gate.authorityId,
        intent: { operationId: crypto.randomUUID(), authorityId: gate.authorityId, lines: lines.map(line => ({ productId: line.productId, quantity: line.quantity })) },
        totalMinor: gate.totalMinor, currencyCode: gate.currencyCode, currencyExponent: gate.currencyExponent, quantity: gate.quantity,
      }
      offlineAttemptRef.current = attempt
      setOfflineConfirmation(attempt)
    } catch {
      if (offlineContextRef.current === key) setOfflineError('Офлайн-разрешение не удалось безопасно проверить. Корзина сохранена.')
    } finally { offlineBusyRef.current = false; setOfflineBusy(false) }
  }

  async function confirmOfflineSale() {
    if (offlineBusyRef.current || !offlineConfirmation || offlineConfirmation.key !== offlineContextRef.current) return
    const attempt = offlineConfirmation
    const gate = offlineGate()
    if (!gate || gate.locationId !== attempt.locationId || gate.authorityId !== attempt.authorityId || offlineAttemptRef.current?.intent.operationId !== attempt.intent.operationId) {
      setOfflineConfirmation(undefined); setOfflineError('Контекст продажи изменился. Повторите проверку офлайн-продажи.'); return
    }
    offlineBusyRef.current = true; setOfflineBusy(true); setOfflineError(undefined)
    try {
      const pricesMatch = await validateOfflinePrices(attempt.locationId, attempt.authorityId, attempt.currencyCode, attempt.currencyExponent, cartLines)
      if (offlineContextRef.current !== attempt.key) { setOfflineConfirmation(undefined); return }
      if (!pricesMatch) {
        setOfflineConfirmation(undefined)
        setOfflineError('Цена или состав корзины изменились. Офлайн-продажа не сохранена.'); return
      }
      const committed = await commitOfflineSale(attempt.intent)
      if (committed.state !== 'COMMITTED_LOCAL' || committed.envelope.offlineOperationId !== attempt.intent.operationId) throw new Error('Local commit not confirmed.')
      completeOfflineSale(attempt.intent.operationId)
    } catch {
      const projection = await readLocalOfflineOperations()
      const local = 'operations' in projection ? projection.operations.find(item => item.operationId === attempt.intent.operationId) : undefined
      if (local || projection.state !== 'ENROLLED') {
        offlineHoldRef.current = true; setOfflineHold(true)
        setOfflineError('Локальный исход требует безопасной проверки. Не создавайте новую продажу; откройте Офлайн-операции.')
      } else setOfflineError('Офлайн-продажа не подтверждена. Корзина сохранена; повторите тот же шаг.')
      setOfflineConfirmation(undefined)
    } finally { offlineBusyRef.current = false; setOfflineBusy(false) }
  }

  function completeOfflineSale(operationId: string) {
    offlineAttemptRef.current = undefined
    setOfflineConfirmation(undefined)
    setOfflineError(undefined)
    setCartLines(clearPosCart())
    setDiscountInputs({}); setDiscountModes({})
    setCheckoutAttempt(undefined); setPaymentAllocations(undefined)
    setCartError(undefined); setCartNotice(undefined)
    setOfflineSuccess(operationId)
  }

  async function submitSale() {
    if (offlineBusyRef.current || offlineHoldRef.current || offlineConfirmation) return
    if (!user
      || !checkoutAttempt
      || !paymentAllocations
      || !paymentSummary
      || !selectedLocation
      || !hasCurrencyConfiguration(selectedLocation)
      || !isCheckoutPreparationAllowed) return

    const ownerUserId = user.id
    const generation = submissionGeneration.current
    const key = `retail-pos-submission:${checkoutAttempt.clientOperationId}`
    setSubmissionState('submitting')
    const result = await runPendingCommand(key, () => submitPosSale({
      ownerUserId,
      checkoutAttempt,
      paymentAllocations,
      paymentSummary,
      currencyExponent: selectedLocation.currencyExponent,
    }, {
      createPayload: createPosCompletionPayload,
      saveSnapshot: savePendingPosSaleSubmission,
      complete: completeRetailSale,
      clearSnapshot: clearPendingPosSaleSubmission,
      isCurrent: () => submissionGeneration.current === generation
        && submissionOwnerUserId.current === ownerUserId,
    }))

    if (!result.started
      || !result.value
      || submissionGeneration.current !== generation
      || submissionOwnerUserId.current !== ownerUserId) return

    const outcome = result.value
    if (outcome.status === 'succeeded') {
      setCartLines(clearPosCart())
      setDiscountInputs({})
      setDiscountModes({})
      setCartError(undefined)
      setCartNotice(undefined)
      setCheckoutAttempt(undefined)
      setPaymentAllocations(undefined)
      setSubmissionState('succeeded')
      return
    }

    setSubmissionState(outcome.status === 'assembly-error'
      ? 'assembly-error'
      : outcome.reason === 'clear-failed' ? 'cleanup-failed' : 'blocked')
    if (outcome.status === 'blocked') {
      setRecoveryGate({ status: 'blocked', ownerUserId, reason: 'pending' })
    }
  }

  async function retryPendingSale() {
    if (!user
      || !pendingRecoverySnapshot
      || pendingRecoverySnapshot.ownerUserId !== user.id
      || recoveryGate.status !== 'blocked'
      || recoveryGate.reason !== 'pending') return

    const ownerUserId = user.id
    const generation = submissionGeneration.current
    const snapshot = pendingRecoverySnapshot
    const key = `retail-pos-recovery:${snapshot.payload.clientOperationId}`
    setRecoveryRetryState('retrying')
    const result = await runPendingCommand(key, () => retryPendingPosSale(snapshot, {
      complete: completeRetailSale,
      clearSnapshot: clearPendingPosSaleSubmission,
      isCurrent: () => submissionGeneration.current === generation
        && submissionOwnerUserId.current === ownerUserId,
    }))

    if (!result.started
      || !result.value
      || submissionGeneration.current !== generation
      || submissionOwnerUserId.current !== ownerUserId) return

    if (result.value.status === 'succeeded') {
      setPendingRecoverySnapshot(undefined)
      setRecoveryGate({ status: 'clear', ownerUserId })
      setRecoveryRetryState('succeeded')
      return
    }

    setRecoveryRetryState(result.value.reason === 'clear-failed'
      ? 'cleanup-failed'
      : 'failed')
  }

  const returnItems = returnSale?.items.map((item) => ({
    ...item,
    remainingReturnableQuantity: item.quantity - item.already_returned_quantity,
  })) ?? []
  const selectedReturnItems = returnItems.flatMap((item) => {
    const quantity = Number(returnQuantities[item.sale_item_id])
    return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= item.remainingReturnableQuantity
      ? [{ saleItemId: item.sale_item_id, quantity }]
      : []
  })
  const isReturnSubmitting = returnSubmissionState === 'submitting'

  function resetReturnForSaleId(value: string) {
    returnLookupGeneration.current += 1
    setReturnSaleId(value)
    setReturnSale(undefined)
    setReturnLookupState('idle')
    setReturnLookupError(undefined)
    setReturnQuantities({})
    setReturnSuccess(undefined)
    setReturnSubmissionState('idle')
  }

  async function lookupReturnSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedLocation) return
    const saleId = returnSaleId.trim()
    const generation = returnLookupGeneration.current + 1
    returnLookupGeneration.current = generation
    setReturnSale(undefined)
    setReturnQuantities({})
    setReturnSuccess(undefined)
    setReturnLookupError(undefined)
    if (!saleId) {
      setReturnLookupState('idle')
      return
    }
    setReturnLookupState('loading')
    try {
      const sale = await getRetailCompletedSale(selectedLocation.id, saleId)
      if (returnLookupGeneration.current !== generation) return
      setReturnSale(sale)
      setReturnLookupState('loaded')
    } catch (error) {
      if (returnLookupGeneration.current !== generation) return
      if (error instanceof HttpError && error.status === 404) setReturnLookupState('not-found')
      else if (error instanceof HttpError && error.status === 403) setReturnLookupState('denied')
      else {
        setReturnLookupError(getLookupErrorMessage(error))
        setReturnLookupState('error')
      }
    }
  }

  async function refreshReturnSale(locationId: string, saleId: string) {
    const generation = returnLookupGeneration.current + 1
    returnLookupGeneration.current = generation
    try {
      const sale = await getRetailCompletedSale(locationId, saleId)
      if (returnLookupGeneration.current === generation) {
        setReturnSale(sale)
        setReturnQuantities({})
        setReturnLookupState('loaded')
      }
    } catch {
      if (returnLookupGeneration.current === generation) setReturnLookupState('error')
    }
  }

  async function submitReturn() {
    if (!user || !selectedLocation || !returnSale || selectedReturnItems.length === 0
      || pendingReturnRecovery || returnRecoveryBlocked || isReturnSubmitting) return
    const payload = createPosReturnIntent({
      locationId: selectedLocation.id,
      saleId: returnSale.sale.id,
      items: selectedReturnItems,
      createId: () => crypto.randomUUID(),
    })
    const generation = returnSubmissionGeneration.current + 1
    returnSubmissionGeneration.current = generation
    setReturnSubmissionState('submitting')
    const result = await submitPosReturn({ ownerUserId: user.id, locationId: selectedLocation.id, payload }, {
      saveSnapshot: savePendingPosReturnSubmission,
      complete: completeRetailReturn,
      clearSnapshot: clearPendingPosReturnSubmission,
      isCurrent: () => returnSubmissionGeneration.current === generation && user.id === submissionOwnerUserId.current,
    })
    if (returnSubmissionGeneration.current !== generation) return
    if (result.status === 'succeeded') {
      setReturnSuccess(result.completion)
      setReturnSubmissionState('succeeded')
      await refreshReturnSale(selectedLocation.id, payload.saleId)
      return
    }
    if (result.status === 'rejected') {
      setReturnSubmissionState('rejected')
      await refreshReturnSale(selectedLocation.id, payload.saleId)
      return
    }
    setReturnSubmissionState(result.reason === 'clear-failed' ? 'cleanup-failed' : 'unknown-result')
    const recovery = loadPendingPosReturnSubmission(user.id)
    setPendingReturnRecovery(recovery.status === 'pending' ? recovery.snapshot : undefined)
  }

  async function retryPendingReturn() {
    if (!user || !pendingReturnRecovery || pendingReturnRecovery.ownerUserId !== user.id || isReturnSubmitting) return
    const generation = returnSubmissionGeneration.current + 1
    returnSubmissionGeneration.current = generation
    setReturnSubmissionState('submitting')
    const result = await retryPendingPosReturn(pendingReturnRecovery, {
      complete: completeRetailReturn,
      clearSnapshot: clearPendingPosReturnSubmission,
      isCurrent: () => returnSubmissionGeneration.current === generation && user.id === submissionOwnerUserId.current,
    })
    if (returnSubmissionGeneration.current !== generation) return
    if (result.status === 'succeeded') {
      setPendingReturnRecovery(undefined)
      setReturnSuccess(result.completion)
      setReturnSubmissionState('succeeded')
      if (selectedLocation?.id === pendingReturnRecovery.locationId) await refreshReturnSale(pendingReturnRecovery.locationId, pendingReturnRecovery.payload.saleId)
      return
    }
    if (result.status === 'rejected') {
      setPendingReturnRecovery(undefined)
      setReturnSubmissionState('rejected')
      return
    }
    setReturnSubmissionState(result.reason === 'clear-failed' ? 'cleanup-failed' : 'unknown-result')
  }

  return (
    <main className="retail-pos">
      <header className="retail-pos__header">
        <h1>Розничная касса</h1>
        <p>Retail POS</p>
      </header>

      {recoveryGate.status === 'checking' && (
        <p className="retail-pos__status" aria-live="polite">
          Проверяем защищённые данные незавершённой продажи…
        </p>
      )}

      {recoveryGate.status === 'blocked' && (
        <Alert variant="warning" title="Новая оплата временно недоступна">
          {getRecoveryGateMessage(recoveryGate.reason)}
        </Alert>
      )}

      {recoveryGate.status === 'blocked'
        && recoveryGate.reason === 'pending'
        && pendingRecoverySnapshot
        && user?.id === pendingRecoverySnapshot.ownerUserId && (
          <Card>
            <h2>Незавершённая продажа</h2>
            <p>Можно повторить завершение сохранённой продажи без изменения её данных.</p>
            <Button
              type="button"
              onClick={() => void retryPendingSale()}
              disabled={recoveryRetryState === 'retrying'}
            >
              {recoveryRetryState === 'retrying'
                ? 'Повторяем завершение продажи…'
                : 'Повторить завершение продажи'}
            </Button>
          </Card>
        )}

      {recoveryRetryState === 'retrying' && (
        <Alert variant="info" title="Повторяем завершение продажи">
          Отправляем сохранённую продажу. Не закрывайте страницу.
        </Alert>
      )}
      {recoveryRetryState === 'failed' && (
        <Alert variant="warning" title="Продажа ожидает безопасной проверки">
          Статус завершения продажи не подтверждён. Новая оплата временно недоступна.
        </Alert>
      )}
      {recoveryRetryState === 'cleanup-failed' && (
        <Alert variant="warning" title="Требуется безопасная проверка">
          Продажа подтверждена сервером, но локальную запись восстановления нельзя безопасно очистить. Создание новой оплаты временно недоступно.
        </Alert>
      )}
      {recoveryRetryState === 'succeeded' && (
        <Alert variant="info" title="Незавершённая продажа восстановлена">
          Продажа подтверждена сервером. Можно начать новую продажу.
        </Alert>
      )}

      {submissionState === 'submitting' && (
        <Alert variant="info" title="Завершаем продажу">
          Отправляем сохранённую продажу. Не закрывайте страницу.
        </Alert>
      )}
      {submissionState === 'assembly-error' && (
        <Alert variant="warning" title="Продажа не подготовлена">
          Не удалось безопасно подготовить продажу. Проверьте корзину и оплату.
        </Alert>
      )}
      {submissionState === 'blocked' && (
        <Alert variant="warning" title="Создание новой оплаты временно недоступно">
          Сохранённые данные восстановления удерживают создание новой оплаты.
        </Alert>
      )}
      {submissionState === 'cleanup-failed' && (
        <Alert variant="warning" title="Требуется безопасная проверка">
          Продажа подтверждена сервером, но локальную запись восстановления нельзя безопасно очистить. Создание новой оплаты временно недоступно.
        </Alert>
      )}
      {submissionState === 'succeeded' && (
        <Alert variant="info" title="Продажа завершена">
          Продажа подтверждена сервером.
        </Alert>
      )}
      {offlineSuccess && (
        <Alert variant="info" title="Сохранено офлайн на этом устройстве">
          <p>Операция {offlineSuccess} сохранена локально и будет отправлена после восстановления связи. Серверное принятие пока не подтверждено.</p>
          <p><Link to="/retail/offline-operations">Открыть Офлайн-операции</Link></p>
        </Alert>
      )}
      {offlineError && <Alert variant="warning" title="Офлайн-продажа не подтверждена">{offlineError}</Alert>}
      {offlineHold && <p><Link to="/retail/offline-operations">Проверить Офлайн-операции</Link></p>}

      {loadState === 'loading' && (
        <p className="retail-pos__status" aria-live="polite">
          Загрузка доступных торговых точек…
        </p>
      )}

      {loadState === 'error' && (
        <section className="retail-pos__state" role="alert">
          <p>Не удалось загрузить доступные торговые точки.</p>
          <button type="button" onClick={() => void loadLocations()}>
            Повторить
          </button>
        </section>
      )}

      {loadState === 'ready' && locations.length === 0 && (
        <p className="retail-pos__status">
          Нет доступных активных торговых точек.
        </p>
      )}

      {loadState === 'ready' && locations.length > 0 && (
        <section className="retail-pos__state">
          <label htmlFor="retail-pos-location">
            Торговая точка
          </label>
          <select
            id="retail-pos-location"
            value={selectedLocationId ?? ''}
            onChange={(event) => selectLocation(event.target.value)}
            disabled={isSubmitting || offlineBusy || offlineHold}
          >
            <option value="">Выберите торговую точку</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} ({location.code})
              </option>
            ))}
          </select>

          {selectedLocation && (
            <p className="retail-pos__selected" aria-live="polite">
              Выбрана торговая точка: {selectedLocation.name} ({selectedLocation.code})
            </p>
          )}
        </section>
      )}

      {cartNotice && (
        <Alert variant="info" title="Корзина очищена">
          {cartNotice}
        </Alert>
      )}

      {!selectedLocation && loadState === 'ready' && locations.length > 0 && (
        <EmptyState
          title="Сначала выберите торговую точку"
          description="Поиск товаров станет доступен после явного выбора торговой точки."
        />
      )}

      {selectedLocation && (
        <section className="retail-pos__workspace" aria-label="Рабочая область кассы">
          <div className="retail-pos__lookup" aria-label="Поиск товара">
            {canReturnSales && (
              <Card className="retail-pos__return">
                <h2>Возврат по завершённой продаже</h2>
                <p>Возврат использует только сохранённые сервером данные продажи.</p>
                {pendingReturnRecovery && user?.id === pendingReturnRecovery.ownerUserId && (
                  <Alert variant="warning" title="Есть незавершённый возврат">
                    Сначала повторите сохранённый возврат с теми же данными. Новый возврат заблокирован.
                    <div className="retail-pos__return-actions">
                      <Button type="button" onClick={() => void retryPendingReturn()} disabled={isReturnSubmitting}>
                        {isReturnSubmitting ? 'Повторяем возврат…' : 'Повторить возврат'}
                      </Button>
                    </div>
                  </Alert>
                )}
                {returnRecoveryBlocked && (
                  <Alert variant="warning" title="Возврат временно недоступен">
                    Сохранённые данные возврата нельзя безопасно подтвердить в этой сессии.
                  </Alert>
                )}
                <form className="retail-pos__lookup-form" onSubmit={lookupReturnSale}>
                  <label htmlFor="retail-pos-return-sale-id">ID завершённой продажи</label>
                  <div className="retail-pos__lookup-controls">
                    <Input id="retail-pos-return-sale-id" value={returnSaleId} onChange={(event) => resetReturnForSaleId(event.target.value)} placeholder="Введите ID продажи" disabled={isReturnSubmitting || !!pendingReturnRecovery || !!returnRecoveryBlocked} />
                    <Button type="submit" disabled={returnLookupState === 'loading' || isReturnSubmitting || !!pendingReturnRecovery || !!returnRecoveryBlocked}>Загрузить продажу</Button>
                  </div>
                </form>
                {returnLookupState === 'loading' && <p className="retail-pos__lookup-status" aria-live="polite"><Spinner size="sm" label="Загрузка продажи" /> Загрузка завершённой продажи…</p>}
                {returnLookupState === 'not-found' && <EmptyState title="Завершённая продажа не найдена" description="Проверьте ID продажи и выбранную торговую точку." />}
                {returnLookupState === 'denied' && <Alert variant="danger" title="Нет доступа к продаже">Нет доступа к завершённой продаже для выбранной торговой точки.</Alert>}
                {returnLookupState === 'error' && returnLookupError && <Alert variant="danger" title="Не удалось загрузить продажу">{returnLookupError}</Alert>}
                {returnSale && returnLookupState === 'loaded' && (
                  <div className="retail-pos__return-evidence">
                    <p><strong>Продажа:</strong> {returnSale.sale.id}</p>
                    <p><strong>К оплате по сохранённой продаже:</strong> {formatUnitPrice(returnSale.sale.payable_total_minor, returnSale.sale.currency_code, returnSale.sale.currency_exponent)}</p>
                    {returnItems.length === 0 ? <EmptyState title="В продаже нет позиций для возврата" description="Сервер не вернул доступных позиций." /> : <ul className="retail-pos__return-lines">
                      {returnItems.map((item) => {
                        const fullyReturned = item.remainingReturnableQuantity <= 0
                        return <li key={item.sale_item_id}>
                          <div><strong>{item.name}</strong><span>{item.source_id}</span><span>Исходное количество: {item.quantity}; уже возвращено: {item.already_returned_quantity}; доступно: {Math.max(0, item.remainingReturnableQuantity)}</span><span>Исходная цена: {formatUnitPrice(item.unit_price_minor, returnSale.sale.currency_code, returnSale.sale.currency_exponent)}; скидка: {formatUnitPrice(item.discount_amount_minor, returnSale.sale.currency_code, returnSale.sale.currency_exponent)}; ранее возвращено: {formatUnitPrice(item.already_refunded_amount_minor, returnSale.sale.currency_code, returnSale.sale.currency_exponent)}</span></div>
                          <label htmlFor={`retail-pos-return-quantity-${item.sale_item_id}`}>Количество возврата
                            <Input id={`retail-pos-return-quantity-${item.sale_item_id}`} type="number" min="1" max={Math.max(0, item.remainingReturnableQuantity)} step="1" value={returnQuantities[item.sale_item_id] ?? ''} onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.sale_item_id]: event.target.value }))} disabled={fullyReturned || isReturnSubmitting || !!pendingReturnRecovery} aria-label={`Количество возврата ${item.name}`} />
                          </label>
                          {fullyReturned && <span className="retail-pos__return-complete">Полностью возвращено</span>}
                        </li>
                      })}
                    </ul>}
                    {returnItems.length > 0 && returnItems.every((item) => item.remainingReturnableQuantity <= 0) && <EmptyState title="Все позиции уже возвращены" description="Для этой продажи нет доступного количества для следующего возврата." />}
                    {returnItems.length > 0 && selectedReturnItems.length === 0 && <Alert variant="info" title="Выберите позиции">Укажите целое количество хотя бы для одной доступной позиции.</Alert>}
                    {selectedReturnItems.length > 0 && <div className="retail-pos__return-review"><strong>Проверка возврата</strong><span>Продажа: {returnSale.sale.id}; торговая точка: {selectedLocation.name}</span><span>Позиций: {selectedReturnItems.length}; количество: {selectedReturnItems.reduce((total, item) => total + item.quantity, 0)}</span><Button type="button" onClick={() => void submitReturn()} disabled={isReturnSubmitting || !!pendingReturnRecovery || !!returnRecoveryBlocked}>Подтвердить возврат</Button></div>}
                  </div>
                )}
                {returnSubmissionState === 'submitting' && <Alert variant="info" title="Отправляем возврат">Отправляем сохранённый возврат. Не закрывайте страницу.</Alert>}
                {returnSubmissionState === 'unknown-result' && <Alert variant="warning" title="Результат возврата не подтверждён">Возврат сохранён для точного повторения. Не создавайте новый возврат.</Alert>}
                {returnSubmissionState === 'rejected' && <Alert variant="warning" title="Возврат отклонён">Сервер отклонил возврат; данные продажи обновлены.</Alert>}
                {returnSubmissionState === 'cleanup-failed' && <Alert variant="warning" title="Требуется безопасная проверка">Серверный результат получен, но локальную запись нельзя безопасно очистить.</Alert>}
                {returnSuccess && <Alert variant="info" title="Возврат подтверждён сервером"><p>ID возврата: {returnSuccess.body.saleReturn.id}</p><p>Исходная продажа: {returnSuccess.body.saleReturn.original_sale_id}</p><p>Возвращённые позиции: {returnSuccess.body.items.map((item) => `${item.quantity} / ${formatUnitPrice(item.refunded_amount_minor, returnSale?.sale.currency_code ?? selectedLocation.currencyCode ?? 'USD', returnSale?.sale.currency_exponent ?? selectedLocation.currencyExponent ?? 2)}`).join(', ') || 'нет'}</p><p>Возвратные оплаты: {returnSuccess.body.refundAllocations.map((allocation) => `${allocation.method}: ${formatUnitPrice(allocation.amount_minor, returnSale?.sale.currency_code ?? selectedLocation.currencyCode ?? 'USD', returnSale?.sale.currency_exponent ?? selectedLocation.currencyExponent ?? 2)}`).join(', ') || 'нет'}</p></Alert>}
              </Card>
            )}
            <Card>
              <form className="retail-pos__lookup-form" onSubmit={searchProducts}>
                <label htmlFor="retail-pos-product-search">Поиск товара</label>
                <div className="retail-pos__lookup-controls">
                  <Input
                    id="retail-pos-product-search"
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Название или код товара"
                    aria-label="Поиск товара по названию или коду"
                  />
                  <Button type="submit" disabled={searchState === 'loading'}>
                    Найти
                  </Button>
                </div>
              </form>

              {searchState === 'loading' && (
                <p className="retail-pos__lookup-status" aria-live="polite">
                  <Spinner size="sm" label="Поиск товаров" /> Поиск товаров…
                </p>
              )}
              {searchState === 'error' && searchError && (
                <Alert variant="danger" title="Не удалось найти товары">
                  {searchError}
                </Alert>
              )}
              {searchState === 'empty' && (
                <EmptyState
                  title="Активные товары не найдены"
                  description="Измените запрос и повторите поиск."
                />
              )}
              {searchHasInactiveProducts && (
                <Alert variant="warning" title="Недоступные товары">
                  Неактивные товары не могут быть выбраны для розничной продажи.
                </Alert>
              )}
              {searchState === 'ready' && (
                <ul className="retail-pos__product-list">
                  {searchResults.map((product) => (
                    <li key={product.id}>
                      <div>
                        <strong>{product.name}</strong>
                        <span>{product.sourceId} · {product.baseUnit}</span>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => selectProduct(product)}
                      >
                        Выбрать
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <form className="retail-pos__lookup-form" onSubmit={lookupBarcode}>
                <label htmlFor="retail-pos-barcode">Штрихкод</label>
                <div className="retail-pos__lookup-controls">
                  <Input
                    id="retail-pos-barcode"
                    value={barcode}
                    onChange={(event) => setBarcode(event.target.value)}
                    placeholder="Введите или отсканируйте штрихкод"
                    aria-label="Поиск товара по штрихкоду"
                  />
                  <Button type="submit" disabled={barcodeState === 'loading'}>
                    Найти
                  </Button>
                </div>
              </form>

              {barcodeState === 'loading' && (
                <p className="retail-pos__lookup-status" aria-live="polite">
                  <Spinner size="sm" label="Поиск по штрихкоду" /> Поиск товара…
                </p>
              )}
              {barcodeState === 'not-found' && (
                <EmptyState
                  title="Товар по штрихкоду не найден"
                  description="Проверьте штрихкод и повторите поиск."
                />
              )}
              {barcodeState === 'error' && barcodeError && (
                <Alert variant="danger" title="Не удалось найти товар">
                  {barcodeError}
                </Alert>
              )}
              {barcodeState === 'unavailable' && barcodeProduct && (
                <Alert variant="warning" title="Товар недоступен">
                  {barcodeProduct.name} — неактивный товар и не может быть выбран.
                </Alert>
              )}
              {barcodeState === 'found' && barcodeProduct && (
                <div className="retail-pos__barcode-result">
                  <div>
                    <strong>{barcodeProduct.name}</strong>
                    <span>{barcodeProduct.sourceId} · {barcodeProduct.baseUnit}</span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => selectProduct(barcodeProduct)}
                  >
                    Выбрать
                  </Button>
                </div>
              )}
            </Card>

            {selectedProduct && (
              <Card variant="soft" className="retail-pos__selected-product">
                <h2>Выбранный товар</h2>
                <p>{selectedProduct.name}</p>
                <span>{selectedProduct.sourceId} · {selectedProduct.baseUnit}</span>
                {priceState === 'currency-unavailable' && (
                  <Alert variant="warning" title="Цена недоступна">
                    Для выбранной торговой точки не настроена валюта.
                  </Alert>
                )}
                {priceState === 'loading' && (
                  <p className="retail-pos__price-status" aria-live="polite">
                    <Spinner size="sm" label="Загрузка цены" /> Загрузка цены…
                  </p>
                )}
                {priceState === 'ready'
                  && unitPriceMinor !== undefined
                  && hasCurrencyConfiguration(selectedLocation) && (
                    <p className="retail-pos__price">
                      Цена: {formatUnitPrice(
                        unitPriceMinor,
                        selectedLocation.currencyCode,
                        selectedLocation.currencyExponent,
                      )}
                    </p>
                  )}
                {canAddSelectedProduct && (
                  <Button type="button" onClick={addSelectedProductToCart} disabled={isSubmitting || offlineBusy || offlineHold}>
                    Добавить в корзину
                  </Button>
                )}
                {priceState === 'missing' && (
                  <EmptyState
                    title="Цена товара не найдена"
                    description="Для выбранной торговой точки цена товара не установлена."
                  />
                )}
                {priceState === 'error' && priceError && (
                  <Alert variant="danger" title="Не удалось загрузить цену">
                    {priceError}
                  </Alert>
                )}
              </Card>
            )}

          </div>
          <div className="retail-pos__checkout">
            <Card className="retail-pos__cart">
              <div className="retail-pos__cart-header">
                <h2>Корзина</h2>
                {cartLines.length > 0 && (
                  <Button type="button" variant="secondary" onClick={clearCart} disabled={isSubmitting || offlineBusy || offlineHold}>
                    Очистить
                  </Button>
                )}
              </div>

              {cartError && (
                <Alert variant="warning" title="Корзина не изменена">
                  {cartError}
                </Alert>
              )}
              {cartLines.length === 0 ? (
                <EmptyState
                  title="Корзина пуста"
                  description="Добавьте товар с готовой текущей ценой."
                />
              ) : (
                <>
                  <ul className="retail-pos__cart-lines">
                    {cartLines.map((line) => (
                      <li key={line.productId}>
                        <div className="retail-pos__cart-line-details">
                          <strong>{line.name}</strong>
                          <span>{line.sourceId} · {line.baseUnit}</span>
                          <span>
                            Текущая цена: {formatUnitPrice(
                              line.unitPriceMinor,
                              line.currencyCode,
                              line.currencyExponent,
                            )}
                          </span>

                          {cartLineTotals?.get(line.productId) !== undefined && (
                            <span>
                              Сумма позиции: {formatUnitPrice(
                                cartLineTotals.get(line.productId)!,
                                line.currencyCode,
                                line.currencyExponent,
                              )}
                            </span>
                          )}

                          {line.discountAmountMinor !== undefined && (
                            <span>
                              {line.discountPercentBasisPoints === undefined
                                ? 'Скидка: '
                                : `Скидка: ${formatDiscountPercent(line.discountPercentBasisPoints)}% (`}
                              −{formatUnitPrice(
                                line.discountAmountMinor,
                                line.currencyCode,
                                line.currencyExponent,
                              )}{line.discountPercentBasisPoints === undefined ? '' : ')'}
                            </span>
                          )}

                          {canApplyDiscount && (
                            <div className="retail-pos__discount-controls">
                              <select
                                value={discountModes[line.productId]
                                  ?? (line.discountPercentBasisPoints === undefined ? 'amount' : 'percent')}
                                onChange={(event) => updateDiscountMode(
                                  line.productId,
                                  event.target.value as DiscountMode,
                                )}
                                aria-label={`Режим скидки для ${line.name}`}
                                disabled={isSubmitting || offlineBusy || offlineHold}
                              >
                                <option value="amount">Сумма</option>
                                <option value="percent">%</option>
                              </select>
                              <Input
                                value={discountInputs[line.productId] ?? ''}
                                onChange={(event) => updateDiscountInput(
                                  line.productId,
                                  event.target.value,
                                )}
                                placeholder={(discountModes[line.productId]
                                  ?? (line.discountPercentBasisPoints === undefined ? 'amount' : 'percent')) === 'amount'
                                  ? 'Сумма скидки'
                                  : 'Процент скидки'}
                                aria-label={(discountModes[line.productId]
                                  ?? (line.discountPercentBasisPoints === undefined ? 'amount' : 'percent')) === 'amount'
                                  ? `Сумма скидки для ${line.name}`
                                  : `Процент скидки для ${line.name}`}
                                disabled={isSubmitting || offlineBusy || offlineHold}
                              />

                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => applyCartLineDiscount(line)}
                                disabled={isSubmitting || offlineBusy || offlineHold}
                              >
                                {line.discountAmountMinor === undefined
                                  ? 'Применить скидку'
                                  : 'Изменить скидку'}
                              </Button>

                              {line.discountAmountMinor !== undefined && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => removeCartLineDiscount(line.productId)}
                                  disabled={isSubmitting || offlineBusy || offlineHold}
                                >
                                  Убрать скидку
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="retail-pos__cart-line-actions">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => decrementCartLine(line.productId)}
                            disabled={isSubmitting || offlineBusy || offlineHold || line.quantity === 1}
                            aria-label={`Уменьшить количество ${line.name}`}
                          >
                            −
                          </Button>
                          <span aria-label={`Количество ${line.name}`}>
                            {line.quantity}
                          </span>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => incrementCartLine(line.productId)}
                            disabled={isSubmitting || offlineBusy || offlineHold}
                            aria-label={`Увеличить количество ${line.name}`}
                          >
                            +
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => removeCartLine(line.productId)}
                            disabled={isSubmitting || offlineBusy || offlineHold}
                          >
                            Удалить
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {cartTotals.status === 'ready' && (
                    <div className="retail-pos__cart-subtotal">
                      <span>Сумма без скидки:</span>
                      <strong>{formatUnitPrice(
                        cartTotals.subtotalMinor,
                        cartTotals.currencyCode,
                        cartTotals.currencyExponent,
                      )}</strong>

                      <span>Скидка:</span>
                      <strong>
                        {cartTotals.discountTotalMinor > 0 ? '−' : ''}
                        {formatUnitPrice(
                          cartTotals.discountTotalMinor,
                          cartTotals.currencyCode,
                          cartTotals.currencyExponent,
                        )}
                      </strong>

                      <span>К оплате:</span>
                      <strong>{formatUnitPrice(
                        cartTotals.payableTotalMinor,
                        cartTotals.currencyCode,
                        cartTotals.currencyExponent,
                      )}</strong>
                    </div>
                  )}
                  {cartTotals.status !== 'ready' && cartTotals.status !== 'empty' && (
                    <Alert variant="warning" title="Сумма корзины недоступна">
                      Не удалось безопасно рассчитать сумму корзины.
                    </Alert>
                  )}
                  <p className="retail-pos__cart-note">
                    Суммы в корзине — текущий снимок. Итоговые значения продажи
                    определит сервер при завершении.
                  </p>
                  {checkoutAttempt && isCheckoutPreparationAllowed ? (
                    <Alert variant="info" title="Корзина подготовлена к оплате">
                      Проверьте корзину перед следующим шагом оформления.
                    </Alert>
                  ) : cartTotals.status === 'ready' ? (
                    <Button
                      type="button"
                      onClick={prepareCheckoutAttempt}
                      disabled={isSubmitting || offlineBusy || offlineHold || !isCheckoutPreparationAllowed}
                    >
                      Перейти к оплате
                    </Button>
                  ) : null}
                </>
              )}
            </Card>
            {checkoutAttempt
              && paymentAllocations
              && paymentSummary
              && selectedLocation
              && isCheckoutPreparationAllowed
              && hasCurrencyConfiguration(selectedLocation) && (
                <Card className="retail-pos__payment">
                  <h2>Оплата</h2>
                  <p>
                    Текущая сумма к оплате: {formatUnitPrice(
                      cartTotals.status === 'ready' ? cartTotals.payableTotalMinor : 0,
                      selectedLocation.currencyCode,
                      selectedLocation.currencyExponent,
                    )}
                  </p>
                  {paymentAllocations.map((allocation, index) => (
                    <div key={allocation.id} className="retail-pos__payment-allocation">
                      <label htmlFor={`retail-pos-payment-method-${index}`}>
                        Способ оплаты
                      </label>
                      <select
                        id={`retail-pos-payment-method-${index}`}
                        value={allocation.method}
                        onChange={(event) => setPaymentAllocations(
                          updatePosPaymentAllocationMethod(
                            paymentAllocations,
                            allocation.id,
                            event.target.value as PosPaymentMethod,
                          ),
                        )}
                        disabled={isSubmitting || offlineBusy || offlineHold}
                      >
                        <option value="cash">Наличные</option>
                        <option value="card">Карта</option>
                        <option value="transfer">Перевод</option>
                        <option value="other">Другое</option>
                      </select>
                      <label htmlFor={`retail-pos-payment-amount-${index}`}>
                        Сумма
                      </label>
                      <Input
                        id={`retail-pos-payment-amount-${index}`}
                        type="text"
                        inputMode="decimal"
                        value={allocation.amountText}
                        onChange={(event) => setPaymentAllocations(
                          updatePosPaymentAllocationAmount(
                            paymentAllocations,
                            allocation.id,
                            event.target.value,
                          ),
                        )}
                        disabled={isSubmitting || offlineBusy || offlineHold}
                        aria-label={`Сумма оплаты ${index + 1}`}
                      />
                      {paymentAllocations.length > 1 && (
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => setPaymentAllocations(
                            removePosPaymentAllocation(paymentAllocations, allocation.id),
                          )}
                          disabled={isSubmitting || offlineBusy || offlineHold}
                        >
                          Удалить
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPaymentAllocations(
                      addPosPaymentAllocation(paymentAllocations, () => crypto.randomUUID()),
                    )}
                    disabled={isSubmitting || offlineBusy || offlineHold}
                  >
                    Добавить оплату
                  </Button>
                  {'allocatedMinor' in paymentSummary && (
                    <p>
                      Внесено: {formatUnitPrice(
                        paymentSummary.allocatedMinor,
                        selectedLocation.currencyCode,
                        selectedLocation.currencyExponent,
                      )}
                    </p>
                  )}
                  {paymentSummary.status === 'incomplete' && (
                    <Alert variant="info" title="Введите сумму оплаты">
                      Заполните сумму для каждой оплаты.
                    </Alert>
                  )}
                  {paymentSummary.status === 'invalid' && (
                    <Alert variant="warning" title="Сумма оплаты недействительна">
                      Укажите положительную сумму в допустимом формате.
                    </Alert>
                  )}
                  {paymentSummary.status === 'overflow' && (
                    <Alert variant="warning" title="Сумма оплаты слишком велика">
                      Укажите сумму в допустимом диапазоне.
                    </Alert>
                  )}
                  {paymentSummary.status === 'remaining' && (
                    <p>
                      Осталось оплатить: {formatUnitPrice(
                        paymentSummary.differenceMinor,
                        selectedLocation.currencyCode,
                        selectedLocation.currencyExponent,
                      )}
                    </p>
                  )}
                  {paymentSummary.status === 'exact' && (
                    <>
                      <p>Сумма оплаты совпадает с текущей суммой корзины.</p>
                      <Button type="button" onClick={() => void submitSale()} disabled={isSubmitting || offlineBusy || offlineHold || !!offlineConfirmation}>
                        {isSubmitting ? 'Завершаем продажу…' : 'Завершить продажу'}
                      </Button>
                    </>
                  )}
                  {paymentSummary.status === 'overpaid' && (
                    <p>
                      Превышение оплаты: {formatUnitPrice(
                        paymentSummary.differenceMinor,
                        selectedLocation.currencyCode,
                        selectedLocation.currencyExponent,
                      )}
                    </p>
                  )}
                  <div className="retail-pos__offline-action">
                    <h3>Офлайн-продажа</h3>
                    <p>Доступна только для полной оплаты наличными без скидки. Состояние сети — подсказка, не подтверждение исхода продажи.</p>
                    {offlineReadinessLoading && <p role="status">Проверяем готовность терминала…</p>}
                    {currentOfflineReadiness?.status !== 'READY' && !offlineReadinessLoading && <p>Терминал не подтверждён готовым для этой торговой точки. Подготовьте его при наличии связи.</p>}
                    <Button type="button" variant="secondary" onClick={() => void prepareOfflineSale()}
                      disabled={offlineBusy || offlineHold || isSubmitting || !!offlineConfirmation || currentOfflineReadiness?.status !== 'READY' || !isCheckoutPreparationAllowed}>
                      {offlineBusy ? 'Проверяем офлайн-продажу…' : 'Сохранить офлайн'}
                    </Button>
                    {offlineConfirmation?.key === offlineContextKey && <Card>
                      <h4>Подтверждение офлайн-продажи</h4>
                      <p>Позиций: {offlineConfirmation.quantity}. Сумма: {formatUnitPrice(offlineConfirmation.totalMinor, offlineConfirmation.currencyCode, offlineConfirmation.currencyExponent)}.</p>
                      <p>Продажа будет сохранена на этом устройстве и отправлена после восстановления связи. Серверное принятие пока не подтверждается.</p>
                      <Button type="button" onClick={() => void confirmOfflineSale()} disabled={offlineBusy}>Подтвердить сохранение офлайн</Button>
                      <Button type="button" variant="secondary" onClick={() => setOfflineConfirmation(undefined)} disabled={offlineBusy}>Отмена</Button>
                    </Card>}
                  </div>
                  <p>
                    Итоговую сумму продажи определит сервер при завершении.
                  </p>
                </Card>
              )}
          </div>
        </section>
      )}
    </main>
  )
}
