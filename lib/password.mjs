import {scrypt,randomBytes,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('Parola 12–256 karakter olmalı.');
 const salt=randomBytes(16).toString('hex');
 const hash=await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return `scrypt$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password,stored){
 if(typeof password!=='string'||password.length>256)return false;
 const [kind,salt,hash]=String(stored).split('$');
 if(kind!=='scrypt'||!salt||!hash)return false;
 const actual=await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const expected=Buffer.from(hash,'hex');return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
