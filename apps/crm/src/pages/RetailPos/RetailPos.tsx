import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { RetailLocation, RetailProduct } from '@madina/retail'
import {
  getRetailLocations,
  getRetailProductByBarcode,
  getRetailProductPrice,
  getRetailProducts,
} from '../../shared/api/retailApi'
import { HttpError } from '../../shared/api/httpClient'
import { Alert, Button, Card, EmptyState, Input, Spinner } from '@madina/ui'
import {
  addPosCartLine,
  calculatePosCartTotals,
  clearPosCart,
  decrementPosCartLine,
  incrementPosCartLine,
  removePosCartLine,
  type PosCartLine,
} from './retailPosCart'
import { createPosCheckoutAttempt, type PosCheckoutAttempt } from './retailPosCheckout'
import './RetailPos.css'

type ProductSearchState = 'idle' | 'loading' | 'empty' | 'ready' | 'error'
type BarcodeLookupState = 'idle' | 'loading' | 'found' | 'not-found' | 'unavailable' | 'error'
type PriceState = 'idle' | 'loading' | 'ready' | 'missing' | 'currency-unavailable' | 'error'

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

function getCartErrorMessage(error: 'invalid-quantity' | 'quantity-overflow'): string {
  return error === 'quantity-overflow'
    ? 'Количество товара не может быть больше допустимого значения.'
    : 'Количество товара должно быть целым положительным числом.'
}

export function RetailPos() {
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
  const [checkoutAttempt, setCheckoutAttempt] = useState<PosCheckoutAttempt>()
  const searchRequestGeneration = useRef(0)
  const barcodeRequestGeneration = useRef(0)
  const priceRequestGeneration = useRef(0)

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

  const loadLocations = useCallback(async () => {
    setLoadState('loading')
    setLocations([])
    setSelectedLocationId(undefined)
    resetProductLookup()
    setCartLines(clearPosCart())
    setCartError(undefined)
    setCartNotice(undefined)
    setCheckoutAttempt(undefined)

    try {
      const retailLocations = await getRetailLocations()
      setLocations(retailLocations.filter(
        (location) => location.status === 'active' && location.type === 'store',
      ))
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [resetProductLookup])

  useEffect(() => {
    void loadLocations()
  }, [loadLocations])

  const selectedLocation = locations.find(
    (location) => location.id === selectedLocationId,
  )
  const cartTotals = calculatePosCartTotals(cartLines)
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
    const hadCartLines = cartLines.length > 0
    setSelectedLocationId(locationId || undefined)
    resetProductLookup()
    setCartLines(clearPosCart())
    setCartError(undefined)
    setCheckoutAttempt(undefined)
    setCartNotice(hadCartLines
      ? 'Корзина очищена после смены торговой точки.'
      : undefined)
  }

  function selectProduct(product: RetailProduct) {
    resetPriceReadiness()
    setSelectedProduct(product)
  }

  function addSelectedProductToCart() {
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
    if (!result.error) setCheckoutAttempt(undefined)
  }

  function incrementCartLine(productId: string) {
    const result = incrementPosCartLine(cartLines, productId)
    setCartLines(result.lines)
    setCartError(result.error ? getCartErrorMessage(result.error) : undefined)
    if (!result.error) setCheckoutAttempt(undefined)
  }

  function decrementCartLine(productId: string) {
    const result = decrementPosCartLine(cartLines, productId)
    setCartLines(result.lines)
    setCartError(result.error ? getCartErrorMessage(result.error) : undefined)
    if (result.lines.some((line, index) => line.quantity !== cartLines[index]?.quantity)) {
      setCheckoutAttempt(undefined)
    }
  }

  function removeCartLine(productId: string) {
    setCartLines(removePosCartLine(cartLines, productId))
    setCartError(undefined)
    if (cartLines.some((line) => line.productId === productId)) {
      setCheckoutAttempt(undefined)
    }
  }

  function clearCart() {
    setCartLines(clearPosCart())
    setCartError(undefined)
    if (cartLines.length > 0) setCheckoutAttempt(undefined)
  }

  function prepareCheckoutAttempt() {
    if (!selectedLocation || cartTotals.status !== 'ready') return

    setCheckoutAttempt(createPosCheckoutAttempt({
      locationId: selectedLocation.id,
      cartLines,
      cartTotals,
      createId: () => crypto.randomUUID(),
    }))
  }

  return (
    <main className="retail-pos">
      <header className="retail-pos__header">
        <h1>Розничная касса</h1>
        <p>Retail POS</p>
      </header>

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
        <section className="retail-pos__lookup" aria-label="Поиск товара">
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
                <Button type="button" onClick={addSelectedProductToCart}>
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

          <Card className="retail-pos__cart">
            <div className="retail-pos__cart-header">
              <h2>Корзина</h2>
              {cartLines.length > 0 && (
                <Button type="button" variant="secondary" onClick={clearCart}>
                  Очистить
                </Button>
              )}
            </div>

            {cartError && (
              <Alert variant="warning" title="Количество не изменено">
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
                      </div>
                      <div className="retail-pos__cart-line-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => decrementCartLine(line.productId)}
                          disabled={line.quantity === 1}
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
                          aria-label={`Увеличить количество ${line.name}`}
                        >
                          +
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => removeCartLine(line.productId)}
                        >
                          Удалить
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                {cartTotals.status === 'ready' && (
                  <div className="retail-pos__cart-subtotal">
                    <span>Итого по корзине:</span>
                    <strong>{formatUnitPrice(
                      cartTotals.subtotalMinor,
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
                {checkoutAttempt ? (
                  <Alert variant="info" title="Корзина подготовлена к оплате">
                    Проверьте корзину перед следующим шагом оформления.
                  </Alert>
                ) : cartTotals.status === 'ready' ? (
                  <Button type="button" onClick={prepareCheckoutAttempt}>
                    Перейти к оплате
                  </Button>
                ) : null}
              </>
            )}
          </Card>
        </section>
      )}
    </main>
  )
}
