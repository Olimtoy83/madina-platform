import { describe, expect, it } from 'vitest'
import { retailSaleDetailPath, retailSaleReturnPath } from './retailSalesLinks'

describe('retail sales links', () => {
  it('preserves the scoped location and exact sale identifier for detail and existing POS return entry', () => {
    expect(retailSaleDetailPath('location / 1', 'sale / 1')).toBe('/retail/sales/sale%20%2F%201?locationId=location%20%2F%201')
    expect(retailSaleReturnPath('location / 1', 'sale / 1')).toBe('/retail/pos?locationId=location%20%2F%201&returnSaleId=sale%20%2F%201')
  })
})
