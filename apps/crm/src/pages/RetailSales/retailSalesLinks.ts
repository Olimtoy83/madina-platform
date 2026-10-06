export function retailSaleDetailPath(locationId: string, saleId: string): string {
  return `/retail/sales/${encodeURIComponent(saleId)}?locationId=${encodeURIComponent(locationId)}`
}

export function retailSaleReturnPath(locationId: string, saleId: string): string {
  return `/retail/pos?locationId=${encodeURIComponent(locationId)}&returnSaleId=${encodeURIComponent(saleId)}`
}
