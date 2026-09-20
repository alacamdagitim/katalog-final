import {cookies,headers} from 'next/headers';
import {createHmac,timingSafeEqual} from 'node:crypto';
export const sessionCookie='alacam_admin';
type Session={email:string;exp:number};
function secret(){const value=process.env.SESSION_SECRET||'';if(value.length<32)throw new Error('SESSION_SECRET en az 32 karakter olmalı.');return value}
function sign(value:string){return createHmac('sha256',secret()).update(value).digest('base64url')}
function safeEqual(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
export async function localAdminPreview(){
 if(process.env.NODE_ENV!=='development'||process.env.LOCAL_ADMIN_PREVIEW!=='1')return false;
 const host=(await headers()).get('host')||'';
 return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
}
export async function identity(){
 if(await localAdminPreview())return {userId:'owner',email:'preview@localhost',displayName:'Yerel önizleme',fullName:'Yerel önizleme'};
 const token=(await cookies()).get(sessionCookie)?.value;if(!token)return null;
 const [body,signature]=token.split('.');if(!body||!signature||!safeEqual(sign(body),signature))return null;
 try{const session=JSON.parse(Buffer.from(body,'base64url').toString()) as Session;if(session.exp<Date.now())return null;return {userId:'owner',email:session.email,displayName:'Firma yöneticisi',fullName:'Firma yöneticisi'};}catch{return null}
}
export async function createSession(email:string){const exp=Date.now()+7*86400000,body=Buffer.from(JSON.stringify({email,exp} satisfies Session)).toString('base64url');(await cookies()).set(sessionCookie,body+'.'+sign(body),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',expires:new Date(exp)})}
export async function revokeSession(){(await cookies()).delete(sessionCookie)}
