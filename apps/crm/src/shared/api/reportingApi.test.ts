import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getReportingSummary } from './reportingApi'

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
})
