export const offlineRetailDatabaseName = 'madina-crm:retail-offline-terminal-identity:v1'
export const identityStoreName = 'identity'
export const authorityStoreName = 'offlineAuthorities'
export const permitStoreName = 'offlinePermits'
export const metadataStoreName = 'offlineMeta'
export const saleStoreName = 'offlineSales'
export const identityRecordKey = 'current'
export const metadataRecordKey = 'state'

export function openOfflineRetailDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(offlineRetailDatabaseName, 3)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(identityStoreName)) db.createObjectStore(identityStoreName)
      if (!db.objectStoreNames.contains(authorityStoreName)) db.createObjectStore(authorityStoreName)
      if (!db.objectStoreNames.contains(permitStoreName)) db.createObjectStore(permitStoreName)
      if (!db.objectStoreNames.contains(metadataStoreName)) db.createObjectStore(metadataStoreName)
      if (!db.objectStoreNames.contains(saleStoreName)) db.createObjectStore(saleStoreName)
    }
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error ?? new Error('Retail Offline storage is unavailable.'))
    request.onblocked = () => reject(new Error('Retail Offline storage upgrade is blocked.'))
  })
}
