import type {
  ImportCommerceSnapshotRequest,
  ImportCommerceSnapshotResponse,
} from '@madina/api'
import { requestJson } from './httpClient'

export function importCommerceSnapshot(
  input: ImportCommerceSnapshotRequest,
): Promise<ImportCommerceSnapshotResponse> {
  return requestJson<ImportCommerceSnapshotResponse>(
    '/api/v1/commerce/import',
    {
      method: 'POST',
      body: input,
    },
  )
}
