export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export const ok=(data:unknown,init:ResponseInit={})=>Response.json(data,{...init,headers:{'Cache-Control':'no-store',...init.headers}});
export const fail=(error:unknown)=>{const known=error instanceof HttpError;return Response.json({error:known?error.message:'İşlem şu anda tamamlanamadı.'},{status:known?error.status:500})};
export async function jsonBody(req:Request):Promise<any>{const length=Number(req.headers.get('content-length')||0);if(length>100000)throw new HttpError(413,'İstek çok büyük.');try{return await req.json()}catch{throw new HttpError(400,'Geçersiz istek.')}}
export function sameOrigin(req:Request){
 const origin=req.headers.get('origin');if(!origin)return;
 const invalid=()=>new HttpError(403,'İstek kaynağı doğrulanamadı.');
 const host=req.headers.get('host');
 // NextURL normalizes loopback addresses to localhost, but the browser does
 // not: preserve the actual request Host rather than allowing cross-host aliases.
 // Forwarded headers never add another allowed origin here.
 if(!host||host.length>255||/[\s/@?#\\,%]/.test(host))throw invalid();
 try{
  const protocol=new URL(req.url).protocol;
  if(protocol!=='http:'&&protocol!=='https:')throw invalid();
  const expected=new URL(`${protocol}//${host}`).origin;
  if(origin!==expected)throw invalid();
 }catch{throw invalid();}
}
