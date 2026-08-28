import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  getIncomeReport,
  getReportingSummary,
} from './reportingApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reportingApi', () => {
  it('loads the server reporting summary without client recalculation', async () => {
    const summary = {
      sales: { completedCount: 4 },
      financial: {
        totalIncome: 120,
        totalExpense: 40,
        financialBalance: 80,
        revenue: 100,
        purchaseExpense: 30,
      },
      inventory: {
        productCount: 2,
        activeProductCount: 1,
        stockByUnit: [{ unit: 'kg', quantity: 5 }],
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(summary),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getReportingSummary()).resolves.toEqual(summary)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/reports/summary',
      expect.objectContaining({
        credentials: 'same-origin',
      }),
    )
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET')
  })

  it('preserves the shared HTTP error behavior', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Reporting is unavailable' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    )))

    await expect(getReportingSummary()).rejects.toMatchObject({
      status: 503,
      message: 'Reporting is unavailable',
    })
  })

  it('loads the first income report page without client-side filters', async () => {
    const incomeReport = {
      summary: {
        totalIncome: 120,
        totalExpense: 40,
        financialBalance: 80,
      },
      transactions: {
        items: [],
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(incomeReport),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getIncomeReport()).resolves.toEqual(incomeReport)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/reports/income',
      expect.objectContaining({
        credentials: 'same-origin',
      }),
    )
  })

  it('forwards income type, limit, and cursor query parameters', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({
        summary: {
          totalIncome: 120,
          totalExpense: 40,
          financialBalance: 80,
        },
        transactions: { items: [] },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    await getIncomeReport({
      type: 'income',
      limit: 25,
      cursor: 'cursor+/=',
    })
    await getIncomeReport({ type: 'expense' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/reports/income?type=income&limit=25&cursor=cursor%2B%2F%3D',
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/reports/income?type=expense',
      expect.anything(),
    )
  })

  it('preserves shared HTTP errors for the income endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Reporting is unavailable' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      },
    )))

    await expect(getIncomeReport({ type: 'income' })).rejects.toMatchObject({
      status: 403,
      message: 'Reporting is unavailable',
    })
  })
})
