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
  getProductWorkbookValidationError,
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
  it('loads the operational commerce aggregate from four server resources', async () => {
    const fetchMock = installFetch([
      { products: [] },
      { stockMovements: [] },
      { purchases: [] },
      { sales: [] },
    ])

    await expect(getCommerceAggregate()).resolves.toEqual({
      products: [], stockMovements: [], purchases: [], sales: [],
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/commerce/products',
      '/api/v1/commerce/stock-movements',
      '/api/v1/commerce/purchases',
      '/api/v1/commerce/sales',
    ])
  })

  it('fails an aggregate load when one server resource fails', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/sales')
        ? response({ message: 'Unavailable' }, 503)
        : response(url.endsWith('/products') ? { products: [] }
          : url.endsWith('/stock-movements') ? { stockMovements: [] }
            : url.endsWith('/purchases') ? { purchases: [] }
              : { sales: [] })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCommerceAggregate()).rejects.toThrow('Unavailable')
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
