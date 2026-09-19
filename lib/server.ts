import {database} from './database';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {Member,permissions,normalize,Product,ProductPage} from './model';
export function db(){return database;}
export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export const has=(u:Member,p:string)=>u.role==='owner'||u.permissions.includes(p);
export const manager=(u:Member)=>u.role==='owner'||u.role==='manager';
export async function currentMember():Promise<Member>{
 const identity=await getChatGPTUser();if(!identity)throw new HttpError(401,'Oturum açmanız gerekiyor.');
 // Returning members need one fresh permission lookup, not repeated bootstrap writes.
 const member=await db().prepare('SELECT * FROM members WHERE authId=?').bind(identity.userId).first<any>();
 if(member){
  if(!member.active)throw new HttpError(403,'Bu çalışma alanına erişiminiz yok. Firma yöneticinizden yetki isteyin.');
  return {...member,permissions:JSON.parse(member.permissions)};
 }
 // The owner is already provisioned. Public visitors must never bootstrap ownership.
 const owner=await db().prepare("SELECT value FROM settings WHERE key='owner_id'").first<{value:string}>();
 if(owner?.value===identity.userId){await db().prepare("INSERT OR IGNORE INTO members(id,email,name,role,permissions,active,authId,createdAt) VALUES(?,?,?,'owner','[]',1,?,?)").bind(identity.userId,identity.email.toLowerCase(),identity.displayName,identity.userId,new Date().toISOString()).run();}
 let row=await db().prepare('SELECT * FROM members WHERE authId=?').bind(identity.userId).first<any>();
 if(!row){const invite=await db().prepare('SELECT * FROM members WHERE email=? AND authId IS NULL AND active=1').bind(identity.email.toLowerCase()).first<any>();if(invite){await db().prepare('UPDATE members SET authId=? WHERE id=? AND authId IS NULL').bind(identity.userId,invite.id).run();row=await db().prepare('SELECT * FROM members WHERE authId=?').bind(identity.userId).first<any>();}}
 if(!row||!row.active)throw new HttpError(403,'Bu çalışma alanına erişiminiz yok. Firma yöneticinizden yetki isteyin.');
 return {...row,permissions:JSON.parse(row.permissions)};
}
export function requirePermission(u:Member,p:string){if(!has(u,p))throw new HttpError(403,'Bu işlem için yetkiniz bulunmuyor.');}
export async function jsonBody(req:Request){const length=Number(req.headers.get('content-length')||0);if(length>6_000_000)throw new HttpError(413,'Dosya çok büyük. İşlemi daha küçük gruplara ayırın.');const text=await req.text();if(text.length>6_000_000)throw new HttpError(413,'İstek çok büyük.');try{return JSON.parse(text)}catch{throw new HttpError(400,'Geçersiz veri.')}}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)throw new HttpError(403,'İstek kaynağı doğrulanamadı.');}
export function fail(e:unknown){console.error('catalog request failed',e instanceof HttpError?e.message:'internal error');return Response.json({error:e instanceof HttpError?e.message:'İşlem tamamlanamadı. Yeniden deneyin.'},{status:e instanceof HttpError?e.status:500,headers:{'Cache-Control':'no-store'}});}
export function ok(data:unknown){return Response.json(data,{headers:{'Cache-Control':'no-store'}})}
export const publicColumns='id,shopifyProductId,shopifyVariantId,handle,title,vendor,type,tags,description,sku,barcode,catalogPrice,stock,visible,status,image,source,version';
export async function listProducts(u:Member|null,params:URLSearchParams):Promise<ProductPage>{
 const where:string[]=[];const binds:any[]=[];const catalog=!u||params.get('view')==='catalog'||!manager(u);
 if(catalog)where.push("visible=1 AND status='active'");
 const q=normalize((params.get('q')||'').slice(0,120)).trim();
 if(q){const tokens=q.match(/[\p{L}\p{N}]+/gu)||[];if(tokens.length){where.push('id IN (SELECT product_id FROM product_search WHERE product_search MATCH ?)');binds.push(tokens.slice(0,12).map(t=>'"'+t.replaceAll('"','')+'"*').join(' AND '));}}
 for(const field of ['vendor','type'])if(params.get(field)){where.push(`${field}=?`);binds.push(params.get(field));}
 if(params.get('tab')==='visible')where.push('visible=1');
 if(params.get('tab')==='missing')where.push("(barcode='' OR image='' OR catalogPrice IS NULL)");
 if(params.get('stock')==='available')where.push('stock>0');
 if(params.get('stock')==='empty')where.push('stock=0');
 const w=where.length?' WHERE '+where.join(' AND '):'';
 const count=await db().prepare('SELECT COUNT(*) n FROM products'+w).bind(...binds).first<{n:number}>();
 const pages=Math.max(1,Math.ceil((count?.n||0)/30));const page=Math.min(pages,Math.max(1,Math.floor(Number(params.get('page'))||1)));
 const sort=params.get('sort');const order=sort==='price-up'?'catalogPrice IS NULL,catalogPrice ASC,title':sort==='price-down'?'catalogPrice IS NULL,catalogPrice DESC,title':'title COLLATE NOCASE,id';
 const items=await db().prepare(`SELECT ${publicColumns} FROM products${w} ORDER BY ${order} LIMIT 30 OFFSET ?`).bind(...binds,(page-1)*30).all<Product>();
 const scope=catalog?" WHERE visible=1 AND status='active'":'';
 const [stats,vendors,types]=await Promise.all([db().prepare("SELECT COUNT(*) total,COALESCE(SUM(visible),0) visible,COALESCE(SUM(barcode='' OR image='' OR catalogPrice IS NULL),0) missing FROM products"+scope).first<any>(),db().prepare('SELECT DISTINCT vendor FROM products'+scope+' ORDER BY vendor').all<any>(),db().prepare('SELECT DISTINCT type FROM products'+scope+' ORDER BY type').all<any>()]);
 return {items:items.results,total:count?.n||0,page,pages,stats,vendors:vendors.results.map(x=>x.vendor).filter(Boolean),types:types.results.map(x=>x.type).filter(Boolean)};
}
export const editableFields=['catalogPrice','visible'] as const;
export const labels:Record<string,string>={title:'Ürün adı',type:'Tür',tags:'Etiketler',catalogPrice:'Katalog fiyatı',visible:'Katalogda göster'};
export function validatePatch(u:Member,patch:any){if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new HttpError(400,'Değişiklik bilgisi geçersiz.');const clean:Record<string,any>={};for(const key of Object.keys(patch)){if(!editableFields.includes(key as any))throw new HttpError(400,'Bu alan düzenlenemez: '+key);requirePermission(u,key==='catalogPrice'?'prices.edit':key==='visible'?'catalog.edit':'products.edit');const v=patch[key];if(key==='catalogPrice'){if(v!==null&&(!Number.isSafeInteger(v)||v<0||v>10000000000))throw new HttpError(400,'Fiyat sıfır veya pozitif bir tutar olmalı.');}else if(key==='visible'){if(v!==0&&v!==1)throw new HttpError(400,'Katalog seçimi geçersiz.');}else if(typeof v!=='string'||v.length>(key==='tags'?2000:300)||key==='title'&&!v.trim())throw new HttpError(400,'Ürün bilgisi geçersiz.');clean[key]=v;}return clean;}
export async function applyChanges(u:Member,changes:any[],batch:string){if(!Array.isArray(changes)||changes.length>100||!changes.length)throw new HttpError(400,'Bir işlemde 1–100 kayıt gönderin.');const seen=new Set();const statements=[];const ids=[];
 for(const change of changes){if(typeof change.id!=='string'||!Number.isSafeInteger(change.version)||seen.has(change.id))throw new HttpError(400,'Geçersiz veya tekrarlanan ürün.');seen.add(change.id);const patch=validatePatch(u,change.patch);if(!Object.keys(patch).length)continue;const old=await db().prepare('SELECT * FROM products WHERE id=?').bind(change.id).first<any>();if(!old||old.version!==change.version)throw new HttpError(409,'Ürün başka bir işlemde değişti. Listeyi yenileyip tekrar deneyin.');const merged={...old,...patch};const search=normalize([merged.title,merged.handle,merged.vendor,merged.type,merged.tags,merged.sku,merged.barcode].join(' '));statements.push(db().prepare(`UPDATE products SET ${Object.keys(patch).map(k=>`"${k}"=?`).join(',')},search=?,version=version+1,lastActor=?,lastBatch=?,updatedAt=? WHERE id=? AND version=?`).bind(...Object.values(patch),search,u.id,batch,new Date().toISOString(),change.id,change.version));ids.push(change.id);}
 if(!statements.length)return {updated:0,conflicts:[]};const results=await db().batch(statements);return {updated:results.filter(r=>r.meta.changes>0).length,conflicts:ids.filter((_,i)=>!results[i].meta.changes)};
}
