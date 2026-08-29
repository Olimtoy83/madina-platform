import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adjustProductStock,
  cancelPurchase,
  cancelSale,
  completePurchase,
  completeSale,
  createProduct,
  createPurchase,
  createSale,
  deactivateProduct,
  downloadProductImportTemplate,
  exportProducts,
  getCommerceAggregate,
  getClientSalesMetrics,
  getNextSaleNumber,
  getProductWorkbookValidationError,
  getSaleById,
  getSalesHistory,
  getStockMovementHistory,
  getStockMovementIntegrity,
  importProductsExcel,
  updateProduct,
  updatePurchase,
  updateSale,
} from './commerceApi'
import { HttpError } from './httpClient'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetch(bodies: unknown[]) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(response(bodies.shift())),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('commerceApi', () => {
  it('loads the operational commerce aggregate from products and purchases only', async () => {
    const fetchMock = installFetch([
      { products: [] },
      { purchases: [] },
    ])

    await expect(getCommerceAggregate()).resolves.toEqual({
      products: [], purchases: [],
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/commerce/products',
      '/api/v1/commerce/purchases',
    ])
  })

  it('fails an aggregate load when one server resource fails', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/purchases')
        ? response({ message: 'Unavailable' }, 503)
        : response({ products: [] })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCommerceAggregate()).rejects.toThrow('Unavailable')
  })

  it('loads bounded stock movement history with encoded filters and maps dates', async () => {
    const fetchMock = installFetch([{
      summary: {
        totalMovements: 4,
        totalPurchases: 7,
        totalSales: 3,
      },
      stockMovements: {
        items: [{
          id: 'movement-1',
          productId: 'product-1',
          type: 'purchase',
          quantity: 2,
          unit: 'kg',
          createdAt: '2026-08-29T12:00:00.000Z',
          updatedAt: '2026-08-29T12:00:00.000Z',
        }],
        nextCursor: 'next-cursor',
      },
    }])

    const history = await getStockMovementHistory({
      productId: 'product/1',
      type: 'purchase',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-29',
      limit: '50',
      cursor: 'cursor value',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/commerce/stock-movements/history?productId=product%2F1&type=purchase&dateFrom=2026-08-01&dateTo=2026-08-29&limit=50&cursor=cursor+value',
      expect.anything(),
    )
    expect(history.stockMovements.items[0]?.createdAt).toEqual(
      new Date('2026-08-29T12:00:00.000Z'),
    )
    expect(history.stockMovements.nextCursor).toBe('next-cursor')
  })

  it('uses the history endpoint defaults without an empty query string', async () => {
    const fetchMock = installFetch([{
      summary: {
        totalMovements: 0,
        totalPurchases: 0,
        totalSales: 0,
      },
      stockMovements: { items: [] },
    }])

    await getStockMovementHistory()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/commerce/stock-movements/history',
      expect.anything(),
    )
  })

  it('loads bounded sales reads with typed query serialization and date mapping', async () => {
    const fetchMock = installFetch([
      {
        summary: { totalCount: 2, draftCount: 1, completedCount: 1, totalAmount: 300 },
        sales: { items: [{ id: 'sale-1', saleNumber: 'SAL-0001', saleDate: '2026-08-29T12:00:00.000Z', clientId: 'client-1', clientName: 'Client', totalAmount: 300, paymentMethod: 'cash', status: 'draft' }], nextCursor: 'next' },
      },
      { id: 'sale-1', createdAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z', saleNumber: 'SAL-0001', saleDate: '2026-08-29T12:00:00.000Z', clientName: 'Client', items: [], totalAmount: 300, paymentMethod: 'cash', status: 'draft' },
      { metrics: [{ clientId: 'client-1', completedCount: 1, completedTotalAmount: 300, lastSaleDate: '2026-08-29T12:00:00.000Z' }] },
      { saleNumber: 'SAL-0002' },
    ])

    const history = await getSalesHistory({ status: 'completed', clientId: 'client/1', cursor: 'opaque cursor' })
    await getSaleById('sale/1')
    await getClientSalesMetrics(['client-1', 'client/2'])
    await getNextSaleNumber()

    expect(history.sales.items[0]?.saleDate).toEqual(new Date('2026-08-29T12:00:00.000Z'))
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/commerce/sales/history?status=completed&clientId=client%2F1&cursor=opaque+cursor',
      '/api/v1/commerce/sales/sale%2F1',
      '/api/v1/commerce/sales/client-metrics?clientIds=client-1%2Cclient%2F2',
      '/api/v1/commerce/sales/next-number',
    ])
  })

  it('serializes each supported history filter without local defaults', async () => {
    const fetchMock = installFetch(Array.from({ length: 6 }, () => ({
      summary: {
        totalMovements: 0,
        totalPurchases: 0,
        totalSales: 0,
      },
      stockMovements: { items: [] },
    })))

    await getStockMovementHistory({ productId: 'product-1' })
    await getStockMovementHistory({ type: 'sale' })
    await getStockMovementHistory({ dateFrom: '2026-08-01' })
    await getStockMovementHistory({ dateTo: '2026-08-29' })
    await getStockMovementHistory({ limit: '25' })
    await getStockMovementHistory({ cursor: 'next' })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/commerce/stock-movements/history?productId=product-1',
      '/api/v1/commerce/stock-movements/history?type=sale',
      '/api/v1/commerce/stock-movements/history?dateFrom=2026-08-01',
      '/api/v1/commerce/stock-movements/history?dateTo=2026-08-29',
      '/api/v1/commerce/stock-movements/history?limit=25',
      '/api/v1/commerce/stock-movements/history?cursor=next',
    ])
  })

  it('loads stock movement integrity from the dedicated server endpoint', async () => {
    const fetchMock = installFetch([{
      discrepancies: [{
        productId: 'product-1',
        productName: 'Dates',
        actualQuantity: 2,
        calculatedQuantity: 1,
        difference: 1,
      }],
    }])

    await expect(getStockMovementIntegrity()).resolves.toEqual({
      discrepancies: [{
        productId: 'product-1',
        productName: 'Dates',
        actualQuantity: 2,
        calculatedQuantity: 1,
        difference: 1,
      }],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/commerce/stock-movements/integrity',
      expect.anything(),
    )
  })

  it('uses server endpoints for every permitted commerce mutation', async () => {
    const fetchMock = installFetch(Array.from({ length: 12 }, () => ({ success: true })))

    await createProduct({ name: 'Dates', category: 'dates', unit: 'kg', costPrice: 10, salePrice: 15, status: 'active', initialQuantity: 0 })
    await updateProduct('product/1', { name: 'New dates' })
    await deactivateProduct('product/1')
    await adjustProductStock('product/1', { quantity: 2, note: 'Count' })
    await createPurchase({ purchaseNumber: 'PUR-1', purchaseDate: '2026-08-27T00:00:00.000Z', supplierName: 'Supplier', items: [], paymentMethod: 'cash' })
    await updatePurchase('purchase/1', { supplierName: 'New supplier' })
    await cancelPurchase('purchase/1')
    await completePurchase('purchase/1')
    await createSale({ saleNumber: 'SAL-1', saleDate: '2026-08-27T00:00:00.000Z', clientName: 'Client', items: [], paymentMethod: 'cash' })
    await updateSale('sale/1', { clientName: 'New client' })
    await cancelSale('sale/1')
    await completeSale('sale/1')

    expect(fetchMock.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      ['/api/v1/commerce/products', 'POST'],
      ['/api/v1/commerce/products/product%2F1', 'PATCH'],
      ['/api/v1/commerce/products/product%2F1/deactivate', 'POST'],
      ['/api/v1/commerce/products/product%2F1/stock-adjustments', 'POST'],
      ['/api/v1/commerce/purchases', 'POST'],
      ['/api/v1/commerce/purchases/purchase%2F1', 'PATCH'],
      ['/api/v1/commerce/purchases/purchase%2F1/cancel', 'POST'],
      ['/api/v1/commerce/purchases/purchase%2F1/complete', 'POST'],
      ['/api/v1/commerce/sales', 'POST'],
      ['/api/v1/commerce/sales/sale%2F1', 'PATCH'],
      ['/api/v1/commerce/sales/sale%2F1/cancel', 'POST'],
      ['/api/v1/commerce/sales/sale%2F1/complete', 'POST'],
    ])
  })

  it('downloads server-generated product template and export workbooks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('template', {
        headers: { 'Content-Disposition': 'attachment; filename="template.xlsx"' },
      }))
      .mockResolvedValueOnce(new Response('export', {
        headers: { 'Content-Disposition': 'attachment; filename="products-2026-08-28.xlsx"' },
      }))
    const createObjectURL = vi.fn().mockReturnValue('blob:product-workbook')
    const revokeObjectURL = vi.fn()
    const click = vi.fn()
    const remove = vi.fn()
    const appendChild = vi.fn()
    const anchors: Array<{
      href?: string
      download?: string
      style: { display?: string }
      click: typeof click
      remove: typeof remove
    }> = []

    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn().mockImplementation(() => {
        const anchor = { style: {}, click, remove }
        anchors.push(anchor)
        return anchor
      }),
    })

    await downloadProductImportTemplate()
    await exportProducts()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/commerce/products/import-template',
      '/api/v1/commerce/products/export',
    ])
    expect(appendChild).toHaveBeenCalledTimes(2)
    expect(click).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(anchors.map((anchor) => anchor.download)).toEqual([
      'template.xlsx',
      'products-2026-08-28.xlsx',
    ])
  })

  it('uploads a product workbook as multipart form data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      importedCount: 2,
      initialStockMovementCount: 1,
    }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['workbook'], 'products.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    await expect(importProductsExcel(file)).resolves.toEqual({
      importedCount: 2,
      initialStockMovementCount: 1,
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/commerce/products/import')
    expect(options?.method).toBe('POST')
    expect(options?.body).toBeInstanceOf(FormData)
    expect(new Headers(options?.headers).has('Content-Type')).toBe(false)
  })

  it('recognizes structured workbook validation errors from an import response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Workbook validation failed.',
      errors: [{ row: 4, column: 'name', code: 'invalid_product', message: 'Name is required.' }],
    }, 422)))

    let capturedError: unknown
    try {
      await importProductsExcel(new File(['workbook'], 'products.xlsx'))
    } catch (error) {
      capturedError = error
    }

    expect(capturedError).toBeInstanceOf(HttpError)
    expect(getProductWorkbookValidationError(capturedError)).toMatchObject({
      errors: [{ row: 4, column: 'name', message: 'Name is required.' }],
    })
    expect(getProductWorkbookValidationError(
      new HttpError(422, 'Bad input.', { message: 'Bad input.' }),
    )).toBeUndefined()
  })
})
