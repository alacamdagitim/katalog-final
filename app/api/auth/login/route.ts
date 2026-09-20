import {createSession} from '@/lib/auth';
import {verifyPassword} from '@/lib/password.mjs';
import {sameOrigin,ok,fail,HttpError,jsonBody} from '@/lib/http';
export const runtime='nodejs';
const attempts=new Map<string,{count:number;resetAt:number}>(),WINDOW=15*60_000,LIMIT=10;
function rateLimit(email:string){
 const now=Date.now(),current=attempts.get(email);
 if(!current||current.resetAt<=now){attempts.set(email,{count:1,resetAt:now+WINDOW});return}
 current.count+=1;if(current.count>LIMIT)throw new HttpError(429,'Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.');
}
export async function POST(req:Request){try{
 sameOrigin(req);const b=await jsonBody(req),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
 const configured=(process.env.ADMIN_EMAIL||'').trim().toLowerCase(),hash=process.env.ADMIN_PASSWORD_HASH||'';
 if(!configured||!hash)throw new HttpError(503,'Yönetici girişi henüz yapılandırılmadı.');
 rateLimit(email);const passwordMatches=await verifyPassword(password,hash);
 if(email!==configured||!passwordMatches)throw new HttpError(401,'E-posta veya parola hatalı.');
 attempts.delete(email);await createSession(configured);return ok({signedIn:true});
}catch(e){return fail(e)}}
