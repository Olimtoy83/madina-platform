import { parentPort, workerData } from 'node:worker_threads'
import { SqliteRetailTransferRepository } from './SqliteRetailTransferRepository.js'

const data=workerData as { file:string; transferId:string; operation:'dispatch'|'receive'; barrier:SharedArrayBuffer; exitBeforeReady?:boolean; barrierTimeoutMs:number }
if(data.exitBeforeReady)process.exit(1)
const repository=new SqliteRetailTransferRepository(data.file)
const state=new Int32Array(data.barrier)

try {
  parentPort!.postMessage({ready:true})
  if(Atomics.wait(state,0,0,data.barrierTimeoutMs)==='timed-out')throw new Error('Transfer concurrency barrier timed out.')
  const transfer=data.operation==='dispatch'
    ?await repository.dispatch(data.transferId,{actorType:'user',actorUserId:'worker',requestId:`worker-${data.operation}`})
    :await repository.receive(data.transferId,{actorType:'user',actorUserId:'worker',requestId:`worker-${data.operation}`})
  parentPort!.postMessage({ok:true,status:transfer.status})
} catch(error) {
  parentPort!.postMessage({ok:false,error:error instanceof Error?error.name:'Error'})
} finally {
  repository.close()
}
