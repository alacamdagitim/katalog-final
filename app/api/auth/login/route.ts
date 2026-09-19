import {database as db} from '@/lib/database';
import {createSession,tokenHash} from '@/lib/auth';
import {verifyPassword,hashPassword} from '@/lib/password.mjs';
import {sameOrigin,ok,fail,HttpError,jsonBody} from '@/lib/server';
export const runtime='nodejs';
let dummy:Promise<string>|undefined;
export async function POST(req:Request){try{
 sameOrigin(req);const b=await jsonBody(req),email=String(b.email||'').trim().toLowerCase();
 if(email.length>254||typeof b.password!=='string'||b.password.length>256)throw new HttpError(400,'Geçersiz giriş bilgileri.');
 // Persistent per-account and global limits also apply to nonexistent users.
 for(const key of ['login-global','login-'+tokenHash(email)]){
  const row=await db.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN windowStart<? THEN 1 ELSE count+1 END,windowStart=CASE WHEN windowStart<? THEN excluded.windowStart ELSE windowStart END RETURNING count').bind(key,Date.now(),Date.now()-900000,Date.now()-900000).first<any>();
  if(row.count>(key==='login-global'?300:10))throw new HttpError(429,'Çok fazla deneme. 15 dakika sonra tekrar deneyin.');
 }
 const row=await db.prepare('SELECT m.id,m.active,c.passwordHash FROM members m JOIN credentials c ON c.memberId=m.id WHERE m.email=?').bind(email).first<any>();
 dummy??=hashPassword('dummy-unusable-'+crypto.randomUUID());
 const valid=await verifyPassword(b.password,row?.passwordHash||await dummy);
 if(!valid||!row?.active)throw new HttpError(401,'E-posta veya parola hatalı.');
 await createSession(row.id);return ok({signedIn:true});
}catch(e){return fail(e)}}
