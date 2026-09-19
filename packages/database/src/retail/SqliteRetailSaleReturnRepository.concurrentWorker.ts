import { parentPort, workerData } from 'node:worker_threads'
import { SqliteRetailSaleReturnRepository, type RetailSaleReturnInput } from './SqliteRetailSaleReturnRepository.js'

const data = workerData as { filename: string; locationId: string; input: RetailSaleReturnInput; context: { actorType: 'user'; actorUserId: string; requestId: string } }
const repository = new SqliteRetailSaleReturnRepository(data.filename)
try {
  parentPort!.postMessage({ ok: true, result: await repository.complete(data.locationId, data.input, data.context) })
} catch (error) {
  parentPort!.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })
} finally { repository.close() }
