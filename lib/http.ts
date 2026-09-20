export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export const ok=(data:unknown,init:ResponseInit={})=>Response.json(data,{...init,headers:{'Cache-Control':'no-store',...init.headers}});
export const fail=(error:unknown)=>{const known=error instanceof HttpError;return Response.json({error:known?error.message:'İşlem şu anda tamamlanamadı.'},{status:known?error.status:500})};
export async function jsonBody(req:Request):Promise<any>{const length=Number(req.headers.get('content-length')||0);if(length>100000)throw new HttpError(413,'İstek çok büyük.');try{return await req.json()}catch{throw new HttpError(400,'Geçersiz istek.')}}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');if(!origin)return;const expected=new URL(req.url).origin;if(origin!==expected)throw new HttpError(403,'İstek kaynağı doğrulanamadı.')}
