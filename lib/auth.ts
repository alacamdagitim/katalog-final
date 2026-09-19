import {cookies} from 'next/headers';
import {createHash,randomBytes} from 'node:crypto';
import {database as db} from './database';
export const sessionCookie='alacam_session';
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function identity(){
 const token=(await cookies()).get(sessionCookie)?.value;if(!token)return null;
 const row=await db.prepare('SELECT m.* FROM sessions s JOIN members m ON m.id=s.memberId WHERE s.tokenHash=? AND s.expiresAt>? AND m.active=1').bind(tokenHash(token),Date.now()).first<any>();
 return row?{userId:row.id,email:row.email,displayName:row.name,fullName:row.name}:null;
}
export async function createSession(memberId:string){
 const token=randomBytes(32).toString('base64url'),expiresAt=Date.now()+7*86400000;
 await db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(tokenHash(token),memberId,expiresAt).run();
 (await cookies()).set(sessionCookie,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',expires:new Date(expiresAt)});
}
export async function revokeSession(){const jar=await cookies(),token=jar.get(sessionCookie)?.value;if(token)await db.prepare('DELETE FROM sessions WHERE tokenHash=?').bind(tokenHash(token)).run();jar.delete(sessionCookie)}
