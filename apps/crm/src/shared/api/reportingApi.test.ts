import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  getAccountingReport,
  getIncomeReport,
  getReportingSummary,
  getSalesReport,
  getStatisticsReport,
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
    await getIncomeReport({ limit: 5 })

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
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/reports/income?limit=5',
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

  it('forwards accounting period, type, limit, and opaque cursor parameters', async () => {
    const accountingReport = {
      summary: {
        totalIncome: 120,
        totalExpense: 40,
        financialBalance: 80,
        transactionCount: 2,
      },
      categories: { sale: 100, purchase: 40, other: 20 },
      transactions: { items: [] },
    }
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(accountingReport), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAccountingReport()).resolves.toEqual(accountingReport)
    await getAccountingReport({ period: 'today' })
    await getAccountingReport({ period: '7days', type: 'income' })
    await getAccountingReport({
      period: 'month',
      type: 'expense',
      limit: 25,
      cursor: 'cursor+/=',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/reports/accounting',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/reports/accounting?period=today',
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/reports/accounting?period=7days&type=income',
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/reports/accounting?period=month&type=expense&limit=25&cursor=cursor%2B%2F%3D',
      expect.anything(),
    )
  })

  it('preserves shared HTTP errors for the accounting endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Reporting is unavailable' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      },
    )))

    await expect(getAccountingReport({ period: 'month' })).rejects.toMatchObject({
      status: 403,
      message: 'Reporting is unavailable',
    })
  })

  it('loads sales reporting periods without browser-side aggregation', async () => {
    const salesReport = {
      period: 'all' as const,
      statusCounts: { draft: 1, completed: 2, cancelled: 3 },
      completedAmount: 120,
    }
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(salesReport), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getSalesReport()).resolves.toEqual(salesReport)
    await getSalesReport({ period: 'today' })
    await getSalesReport({ period: '7days' })
    await getSalesReport({ period: 'month' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/reports/sales',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/reports/sales?period=today',
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/reports/sales?period=7days',
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/reports/sales?period=month',
      expect.anything(),
    )
  })

  it('loads statistics reports with server-owned periods and cursors', async () => {
    const statisticsReport = {
      period: 'all' as const,
      financial: {
        totalIncome: 120,
        totalExpense: 40,
        financialBalance: 80,
        transactionCount: 2,
        categories: { sale: 100, purchase: 40, other: 20 },
      },
      sales: { completedCount: 1 },
      purchases: { completedCount: 1 },
      inventory: { productCount: 2, stockByUnit: [] },
      tasks: { total: 3, todo: 1, inProgress: 1, completed: 1 },
      operations: { items: [] },
    }
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(statisticsReport), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getStatisticsReport()).resolves.toEqual(statisticsReport)
    await getStatisticsReport({ period: 'today' })
    await getStatisticsReport({ period: '7days', limit: 25 })
    await getStatisticsReport({
      period: 'month',
      limit: 50,
      cursor: 'cursor+/=',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/reports/statistics',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/reports/statistics?period=today',
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/reports/statistics?period=7days&limit=25',
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/reports/statistics?period=month&limit=50&cursor=cursor%2B%2F%3D',
      expect.anything(),
    )
  })
})
