export type TransferProgress={done:number;waiting:boolean};
type Request=(body:unknown)=>Promise<any>;
export async function runShopifyTransfer({id,request,signal,onProgress,sleep,initialDone=0}:{id:string;request:Request;signal:AbortSignal;onProgress:(p:TransferProgress)=>void;sleep:(ms:number)=>Promise<void>;initialDone?:number}):Promise<number|null>{
 let retries=0,lastDone=initialDone;
 while(!signal.aborted){
  let result;
  try{result=await request({action:'step',id})}catch(error){
   if(signal.aborted)return null;
   const status=(error as any).status;
   if((status===409||status===429||status>=500||error instanceof TypeError)&&retries<8){
    retries++;onProgress({done:lastDone,waiting:true});await sleep(Math.min(30000,2000*2**(retries-1)));continue;
   }
   throw error;
  }
  if(signal.aborted)return null;
  if(result.state==='cancelled')return null;
  lastDone=Math.max(lastDone,result.done);
  onProgress({done:lastDone,waiting:!!result.retryAfterMs});
  if(result.state==='done')return lastDone;
  retries=result.retryAfterMs?retries+1:0;
  if(retries>8)throw new Error('Shopify sınırı devam ediyor. İlerlemeniz kaydedildi; daha sonra yeniden deneyin.');
  await sleep(result.retryAfterMs?Math.min(30000,result.retryAfterMs*2**(retries-1)):100);
 }
 return null;
}
