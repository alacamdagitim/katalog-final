import {createClient} from '@libsql/client';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {hashPassword} from '../lib/password.mjs';
const rl=createInterface({input:process.stdin,output:process.stdout});
const email=(await rl.question('E-posta: ')).trim().toLowerCase();
const name=(await rl.question('Ad soyad: ')).trim();
const role=(await rl.question('Rol (owner / manager / staff): ')).trim();rl.close();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!name||!['owner','manager','staff'].includes(role))throw new Error('Geçersiz hesap bilgisi');
process.stdout.write('Parola (en az 12 karakter, gizli): ');
const hidden=createInterface({input:process.stdin,output:new Writable({write(_c,_e,cb){cb()}}),terminal:true});
const password=await hidden.question('');hidden.close();process.stdout.write('\n');
const passwordHash=await hashPassword(password);
const db=createClient({url:process.env.DATABASE_URL,authToken:process.env.DATABASE_AUTH_TOKEN});
const existing=await db.execute({sql:'SELECT m.id,m.role,c.passwordHash FROM members m LEFT JOIN credentials c ON c.memberId=m.id WHERE m.email=?',args:[email]});
if(existing.rows.length){
 const row=existing.rows[0];if(row.passwordHash)throw new Error('Hesap zaten etkin; mevcut parola değiştirilmedi.');
 if(row.role!==role)throw new Error('Girilen rol paneldeki rolle eşleşmiyor.');
 await db.batch([{sql:'INSERT INTO credentials VALUES(?,?)',args:[row.id,passwordHash]},{sql:'UPDATE members SET authId=id WHERE id=?',args:[row.id]}],'write');
 console.log('Paneldeki hesap mevcut yetkileri korunarak etkinleştirildi.');db.close();process.exit(0);
}
const id=crypto.randomUUID(),now=new Date().toISOString();
await db.batch([{sql:'INSERT INTO members(id,email,name,role,permissions,active,authId,createdAt) VALUES(?,?,?,?,?,1,?,?)',args:[id,email,name,role,JSON.stringify(role==='manager'?['prices.edit','catalog.edit','excel.import','excel.export','shopify.sync','history.view','users.manage','orders.create','orders.view_all','orders.record_approval']:role==='staff'?['orders.create','orders.record_approval']:[]),id,now]},{sql:'INSERT INTO credentials VALUES(?,?)',args:[id,passwordHash]}],'write');
console.log('Hesap oluşturuldu. Parola kayıtlara yazdırılmadı.');db.close();
